import {
  SpotifyOperationInvalidatedError,
  withSpotifyOperation,
} from "./operations";
import { setTimeout as delay } from "node:timers/promises";

import { connectDB } from "@/lib/db";
import SpotifyConnection from "@/models/SpotifyConnection";

import type { SpotifyConfig } from "./config";
import { decryptSpotifyCredential } from "./encryption";
import {
  SpotifyGenerationError,
  withSpotifyLinkGeneration,
} from "./generation";
import { acquireSpotifyRefreshLease } from "./refresh-lease";
import {
  persistSpotifyRefresh,
  settleSpotifyRefreshFailure,
} from "./refresh-persistence";
import {
  refreshSpotifyCredentials,
  SpotifyRefreshProviderError,
} from "./refresh-provider";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

export const SPOTIFY_ACCESS_REFRESH_MARGIN_MS = 60_000;

export class SpotifyAccessTokenError extends Error {
  constructor(
    public readonly code:
      | "not_connected"
      | "reauthorization_required"
      | "refresh_busy"
      | "connection_changed"
      | "unavailable",
    public readonly retryAfterSeconds?: number,
  ) {
    super("Spotify access unavailable");
    this.name = "SpotifyAccessTokenError";
  }
}

export type SpotifyAccessToken = {
  accessToken: string;
  tokenVersion: number;
  generation: number;
  refreshPerformed: boolean;
};

type Input = {
  userId: string;
  generation: number;
  config: EnabledSpotifyConfig;
  signal?: AbortSignal;
  now?: () => Date;
  // A provider GET rejected this version with 401. A newer version may be used
  // without initiating another refresh.
  forceRefreshTokenVersion?: number;
};

function currentTime(input: Input): Date {
  const value = input.now ? input.now() : new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SpotifyAccessTokenError("unavailable");
  }
  return new Date(value.getTime());
}

async function readConnection(input: Input) {
  return withSpotifyLinkGeneration(
    input.userId,
    input.generation,
    session => SpotifyConnection.findOne({
      userId: input.userId,
      generation: input.generation,
    })
      .select("+accessToken +refreshToken +refreshLeaseOwner +refreshLeaseExpiresAt")
      .session(session)
      .lean()
      .exec(),
  );
}

function usable(expiry: unknown, now: Date): boolean {
  return expiry instanceof Date &&
    Number.isFinite(expiry.getTime()) &&
    expiry.getTime() > now.getTime() + SPOTIFY_ACCESS_REFRESH_MARGIN_MS;
}

function credential(value: string): string {
  if (!/^[\x21-\x7e]{1,16384}$/.test(value)) {
    throw new SpotifyAccessTokenError("unavailable");
  }
  return value;
}

// Backend only. Never return this credential-bearing result from a route.
// HTTP runs outside automatically retried database transactions.
async function getSpotifyAccessTokenWithinOperation(input: Input): Promise<SpotifyAccessToken> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(20_000),
    ...(input.signal ? [input.signal] : []),
  ]);
  const waitDeadline = performance.now() + 2000;
  let initialVersion: number | undefined;

  try {
    if (!input.config.enabled) throw new SpotifyAccessTokenError("unavailable");
    if (
      input.forceRefreshTokenVersion !== undefined &&
      (!Number.isSafeInteger(input.forceRefreshTokenVersion) ||
        input.forceRefreshTokenVersion < 0)
    ) {
      throw new SpotifyAccessTokenError("unavailable");
    }

    signal.throwIfAborted();
    await connectDB();

    while (true) {
      signal.throwIfAborted();
      const connection = await readConnection(input);
      signal.throwIfAborted();

      if (!connection) throw new SpotifyAccessTokenError("not_connected");
      if (connection.status === "reauthorization_required") {
        throw new SpotifyAccessTokenError("reauthorization_required");
      }
      if (
        connection.status !== "connected" ||
        !Number.isSafeInteger(connection.tokenVersion) ||
        connection.tokenVersion < 0 ||
        connection.tokenVersion >= Number.MAX_SAFE_INTEGER
      ) {
        throw new SpotifyAccessTokenError("unavailable");
      }

      initialVersion ??= connection.tokenVersion;
      const time = currentTime(input);
      const forceVersion = input.forceRefreshTokenVersion;
      if (forceVersion !== undefined && connection.tokenVersion < forceVersion) {
        throw new SpotifyAccessTokenError("connection_changed");
      }

      const forceRefresh = forceVersion === connection.tokenVersion;
      const hasOwner = connection.refreshLeaseOwner !== undefined;

      if (
        !hasOwner &&
        !forceRefresh &&
        usable(connection.accessExpiresAt, time)
      ) {
        return {
          accessToken: credential(decryptSpotifyCredential(
            connection.accessToken,
            {
              userId: input.userId,
              generation: input.generation,
              purpose: "access_token",
            },
            input.config,
          )),
          tokenVersion: connection.tokenVersion,
          generation: input.generation,
          refreshPerformed: false,
        };
      }

      // An ownerless future expiry records a definite provider rejection.
      // Do not turn concurrent waiting callers into independent POST retries.
      const leaseExpiry = connection.refreshLeaseExpiresAt;
      if (
        !hasOwner &&
        leaseExpiry instanceof Date &&
        leaseExpiry.getTime() > time.getTime()
      ) {
        throw new SpotifyAccessTokenError(
          "refresh_busy",
          Math.ceil((leaseExpiry.getTime() - time.getTime()) / 1000),
        );
      }

      if (connection.tokenVersion !== initialVersion) {
        throw new SpotifyAccessTokenError("unavailable");
      }

      const acquired = await acquireSpotifyRefreshLease({
        userId: input.userId,
        generation: input.generation,
        tokenVersion: connection.tokenVersion,
        now: input.now,
      });

      if (acquired.state === "reauthorization_required") {
        throw new SpotifyAccessTokenError("reauthorization_required");
      }
      if (acquired.state === "stale") continue;
      if (acquired.state === "busy") {
        if (performance.now() >= waitDeadline) {
          throw new SpotifyAccessTokenError("refresh_busy");
        }
        await delay(100, undefined, { signal });
        continue;
      }

      const lease = acquired.lease;
      let attempted = false;

      try {
        signal.throwIfAborted();
        const owned = await readConnection(input);
        if (
          !owned ||
          owned.status !== "connected" ||
          owned.tokenVersion !== lease.tokenVersion ||
          owned.refreshLeaseOwner !== lease.owner ||
          !(owned.refreshLeaseExpiresAt instanceof Date) ||
          owned.refreshLeaseExpiresAt.getTime() <= currentTime(input).getTime()
        ) {
          throw new SpotifyAccessTokenError("connection_changed");
        }

        const refreshToken = credential(decryptSpotifyCredential(
          owned.refreshToken,
          {
            userId: input.userId,
            generation: input.generation,
            purpose: "refresh_token",
          },
          input.config,
        ));

        signal.throwIfAborted();
        attempted = true;
        const result = await refreshSpotifyCredentials({
          refreshToken,
          config: input.config,
          signal,
          now: input.now,
        });

        signal.throwIfAborted();
        const persisted = await persistSpotifyRefresh({
          lease,
          result,
          config: input.config,
          now: input.now,
        });

        if (!persisted) {
          throw new SpotifyAccessTokenError("connection_changed");
        }
        signal.throwIfAborted();

        if (!usable(result.accessExpiresAt, currentTime(input))) {
          // No retry loop for an unexpectedly short-lived provider token.
          throw new SpotifyAccessTokenError("unavailable");
        }

        return {
          accessToken: result.accessToken,
          tokenVersion: lease.tokenVersion + 1,
          generation: input.generation,
          refreshPerformed: true,
        };
      } catch (error) {
        if (
          error instanceof SpotifyAccessTokenError &&
          (error.code === "connection_changed" || attempted)
        ) {
          throw error;
        }

        const failure = error instanceof SpotifyRefreshProviderError
          ? error
          : new SpotifyRefreshProviderError(
              "provider_error",
              attempted ? "ambiguous" : "not_sent",
            );

        const settled = await settleSpotifyRefreshFailure({
          lease, error: failure, now: input.now,
        });
        if (!settled) throw new SpotifyAccessTokenError("connection_changed");

        if (
          failure.outcome === "invalid_grant" ||
          failure.outcome === "ambiguous"
        ) {
          throw new SpotifyAccessTokenError("reauthorization_required");
        }
        throw new SpotifyAccessTokenError("unavailable", failure.retryAfterSeconds);
      }
    }
  } catch (error) {
    if (error instanceof SpotifyAccessTokenError) throw error;
    if (error instanceof SpotifyGenerationError) {
      throw new SpotifyAccessTokenError("connection_changed");
    }
    throw new SpotifyAccessTokenError("unavailable");
  }
}

// Registers before database generation validation and provider dispatch.
export async function getSpotifyAccessToken(input: Input): Promise<SpotifyAccessToken> {
  try {
    return await withSpotifyOperation(
      {
        userId: input.userId,
        generation: input.generation,
        signal: input.signal,
      },
      signal => getSpotifyAccessTokenWithinOperation({ ...input, signal }),
    );
  } catch (error) {
    if (error instanceof SpotifyOperationInvalidatedError) {
      throw new SpotifyAccessTokenError("connection_changed");
    }
    if (error instanceof SpotifyAccessTokenError) throw error;
    throw new SpotifyAccessTokenError("unavailable");
  }
}
