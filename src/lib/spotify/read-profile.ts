import { setTimeout as delay } from "node:timers/promises";

import SpotifyConnection from "@/models/SpotifyConnection";

import {
  getSpotifyAccessToken,
  SpotifyAccessTokenError,
  type SpotifyAccessToken,
} from "./access-token";
import type { SpotifyConfig } from "./config";
import {
  SpotifyGenerationError,
  withSpotifyLinkGeneration,
} from "./generation";
import { requireSpotifyReauthorization } from "./reauthorization";
import {
  boundedJson,
  parseSpotifyRetryAfter,
  withinSignal,
} from "./refresh-provider";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

type ReadCode =
  | "unauthorized"
  | "access_restricted"
  | "rate_limited"
  | "provider_error"
  | "invalid_response"
  | "reauthorization_required"
  | "connection_changed"
  | "unavailable";

export class SpotifyReadError extends Error {
  constructor(
    public readonly code: ReadCode,
    public readonly retryAfterSeconds?: number,
    public readonly retryable = false,
  ) {
    super("Spotify read request failed");
    this.name = "SpotifyReadError";
  }
}

type Input = {
  userId: string;
  generation: number;
  config: EnabledSpotifyConfig;
  signal?: AbortSignal;
  now?: () => Date;
};

function currentTime(input: Input): Date {
  const value = input.now ? input.now() : new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SpotifyReadError("unavailable");
  }
  return new Date(value.getTime());
}

// Revalidate ownership before each GET, including read retries.
// No credentials are selected here.
async function currentAccount(input: Input, token: SpotifyAccessToken) {
  const connection = await withSpotifyLinkGeneration(
    input.userId,
    input.generation,
    session => SpotifyConnection.findOne({
      userId: input.userId,
      generation: input.generation,
      tokenVersion: token.tokenVersion,
      status: "connected",
      refreshLeaseOwner: { $exists: false },
    })
      .select({ _id: 0, accountId: 1 })
      .session(session)
      .lean()
      .exec(),
  );

  if (!connection) throw new SpotifyReadError("connection_changed");
  return connection.accountId;
}

async function readOnce(
  input: Input,
  token: SpotifyAccessToken,
  accountId: string,
  overall: AbortSignal,
): Promise<{ displayName: string | null }> {
  const signal = AbortSignal.any([overall, AbortSignal.timeout(10_000)]);
  signal.throwIfAborted();

  let response: Response;
  try {
    response = await withinSignal(
      fetch("https://api.spotify.com/v1/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json",
        },
        redirect: "error",
        cache: "no-store",
        signal,
      }),
      signal,
    );
  } catch {
    throw new SpotifyReadError("provider_error", undefined, !overall.aborted);
  }

  if (!response.ok) {
    const retryAfter = response.status === 429
      ? parseSpotifyRetryAfter(response.headers.get("retry-after"), currentTime(input))
      : undefined;
    void response.body?.cancel().catch(() => undefined);

    throw new SpotifyReadError(
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "access_restricted"
          : response.status === 429
            ? "rate_limited"
            : "provider_error",
      retryAfter,
      [500, 502, 503, 504].includes(response.status),
    );
  }

  try {
    const body = await boundedJson(response, signal);
    const displayName = body.display_name ?? null;

    if (
      typeof body.account_id !== "string" ||
      body.account_id !== accountId ||
      (displayName !== null &&
        (typeof displayName !== "string" || displayName.length > 256))
    ) {
      throw new Error("Invalid profile");
    }

    signal.throwIfAborted();
    // Do not return raw provider data, account identifiers, email or credentials.
    return { displayName };
  } catch {
    if (signal.aborted) {
      throw new SpotifyReadError("provider_error", undefined, !overall.aborted);
    }
    throw new SpotifyReadError("invalid_response");
  }
}

// Backend only. Fixed safe GET destination; no caller-supplied URL.
// One shared budget covers token acquisition, refresh, waits and GET attempts.
export async function readSpotifyCurrentProfile(
  input: Input,
): Promise<{ displayName: string | null }> {
  const deadline = performance.now() + 20_000;
  const signal = AbortSignal.any([
    AbortSignal.timeout(20_000),
    ...(input.signal ? [input.signal] : []),
  ]);

  try {
    let token = await getSpotifyAccessToken({ ...input, signal });
    let refreshed = token.refreshPerformed;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal.throwIfAborted();
      const accountId = await currentAccount(input, token);
      signal.throwIfAborted();

      try {
        const result = await readOnce(input, token, accountId, signal);
        signal.throwIfAborted();
        await currentAccount(input, token);
        signal.throwIfAborted();
        return result;
      } catch (error) {
        if (!(error instanceof SpotifyReadError)) throw error;
        signal.throwIfAborted();

        if (error.code === "unauthorized") {
          if (refreshed) {
            const changed = await requireSpotifyReauthorization({
              userId: input.userId,
              generation: input.generation,
              tokenVersion: token.tokenVersion,
            });
            throw new SpotifyReadError(
              changed ? "reauthorization_required" : "connection_changed",
            );
          }

          if (attempt === 1) {
            // The read-retry budget was already used by a transient failure.
            // Do not invalidate credentials without trying a fresh token.
            throw new SpotifyReadError("provider_error");
          }

          token = await getSpotifyAccessToken({
            ...input,
            signal,
            forceRefreshTokenVersion: token.tokenVersion,
          });
          refreshed = true;
          continue;
        }

        if (attempt === 1) throw error;

        let waitMs: number;
        if (error.code === "rate_limited") {
          if (error.retryAfterSeconds === undefined) throw error;
          waitMs = error.retryAfterSeconds * 1000;
        } else if (error.retryable) {
          waitMs = 100 + Math.floor(Math.random() * 100);
        } else {
          throw error;
        }

        if (!Number.isFinite(waitMs) || waitMs >= deadline - performance.now()) {
          throw error;
        }

        if (waitMs > 0) await delay(waitMs, undefined, { signal });
      }
    }

    throw new SpotifyReadError("provider_error");
  } catch (error) {
    if (error instanceof SpotifyReadError) throw error;
    if (error instanceof SpotifyGenerationError) {
      throw new SpotifyReadError("connection_changed");
    }
    if (error instanceof SpotifyAccessTokenError) {
      throw new SpotifyReadError(
        error.code === "reauthorization_required"
          ? "reauthorization_required"
          : error.code === "connection_changed"
            ? "connection_changed"
            : "unavailable",
        error.retryAfterSeconds,
      );
    }
    throw new SpotifyReadError("unavailable");
  }
}
