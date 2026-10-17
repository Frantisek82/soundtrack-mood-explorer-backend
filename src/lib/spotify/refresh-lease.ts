import { randomUUID } from "node:crypto";

import SpotifyConnection from "@/models/SpotifyConnection";

import { withSpotifyLinkGeneration } from "./generation";

export const SPOTIFY_REFRESH_LEASE_MS = 30_000;

export type SpotifyRefreshLease = {
  connectionId: string;
  userId: string;
  generation: number;
  tokenVersion: number;
  owner: string;
  expiresAt: Date;
};

export type SpotifyRefreshLeaseResult =
  | { state: "acquired"; lease: SpotifyRefreshLease }
  | { state: "busy"; retryAt: Date }
  | { state: "stale" }
  | { state: "reauthorization_required" };

function currentTime(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Invalid Spotify refresh clock");
  }
  return new Date(value.getTime());
}

// Database operations only. Never dispatch provider HTTP inside this callback.
// An existing expired owner represents an uncertain previous refresh outcome.
export async function acquireSpotifyRefreshLease(input: {
  userId: string;
  generation: number;
  tokenVersion: number;
  now?: () => Date;
}): Promise<SpotifyRefreshLeaseResult> {
  if (
    !Number.isSafeInteger(input.tokenVersion) ||
    input.tokenVersion < 0 ||
    input.tokenVersion >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Invalid Spotify token version");
  }

  const now = input.now ?? (() => new Date());
  const owner = randomUUID();

  return withSpotifyLinkGeneration<SpotifyRefreshLeaseResult>(
    input.userId,
    input.generation,
    async (session) => {
      const time = currentTime(now);
      const connection = await SpotifyConnection.findOne({
        userId: input.userId,
        generation: input.generation,
        tokenVersion: input.tokenVersion,
        status: "connected",
      })
        .select("_id +refreshLeaseOwner +refreshLeaseExpiresAt")
        .session(session)
        .lean();

      if (!connection) return { state: "stale" };

      const expiry = connection.refreshLeaseExpiresAt;
      const validExpiry =
        expiry instanceof Date && Number.isFinite(expiry.getTime());

      if (connection.refreshLeaseOwner !== undefined) {
        if (validExpiry && expiry.getTime() > time.getTime()) {
          return { state: "busy", retryAt: expiry };
        }

        // Do not reuse credentials after an abandoned, possibly dispatched POST.
        // Commit this transition before reporting reauthorization to the caller.
        const changed = await SpotifyConnection.updateOne(
          {
            _id: connection._id,
            generation: input.generation,
            tokenVersion: input.tokenVersion,
            status: "connected",
          },
          {
            $set: { status: "reauthorization_required" },
            $inc: { tokenVersion: 1 },
            $unset: {
              accessToken: "",
              refreshToken: "",
              accessExpiresAt: "",
              refreshLeaseOwner: "",
              refreshLeaseExpiresAt: "",
            },
          },
          { session, runValidators: true },
        );

        return changed.matchedCount === 1
          ? { state: "reauthorization_required" }
          : { state: "stale" };
      }

      // An ownerless future expiry is a provider-rejection cooldown.
      if (validExpiry && expiry.getTime() > time.getTime()) {
        return { state: "busy", retryAt: expiry };
      }

      const expiresAt = new Date(time.getTime() + SPOTIFY_REFRESH_LEASE_MS);
      if (!Number.isFinite(expiresAt.getTime())) {
        throw new Error("Invalid Spotify refresh clock");
      }

      const changed = await SpotifyConnection.updateOne(
        {
          _id: connection._id,
          generation: input.generation,
          tokenVersion: input.tokenVersion,
          status: "connected",
          refreshLeaseOwner: { $exists: false },
        },
        {
          $set: {
            refreshLeaseOwner: owner,
            refreshLeaseExpiresAt: expiresAt,
          },
        },
        { session, runValidators: true },
      );

      if (changed.matchedCount !== 1) return { state: "stale" };

      return {
        state: "acquired",
        lease: {
          connectionId: connection._id.toString(),
          userId: input.userId,
          generation: input.generation,
          tokenVersion: input.tokenVersion,
          owner,
          expiresAt,
        },
      };
    },
  );
}
