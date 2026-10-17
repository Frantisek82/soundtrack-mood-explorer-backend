import SpotifyConnection from "@/models/SpotifyConnection";

import type { SpotifyConfig } from "./config";
import { encryptSpotifyCredential } from "./encryption";
import { withSpotifyLinkGeneration } from "./generation";
import type { SpotifyRefreshLease } from "./refresh-lease";
import {
  SpotifyRefreshProviderError,
  type SpotifyRefreshResult,
} from "./refresh-provider";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

function currentTime(now?: () => Date): Date {
  const value = now ? now() : new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Invalid Spotify refresh clock");
  }
  return new Date(value.getTime());
}

function leaseFilter(lease: SpotifyRefreshLease, time: Date) {
  if (
    !Number.isSafeInteger(lease.tokenVersion) ||
    lease.tokenVersion < 0 ||
    lease.tokenVersion >= Number.MAX_SAFE_INTEGER ||
    typeof lease.owner !== "string" ||
    lease.owner.length === 0
  ) {
    throw new Error("Invalid Spotify refresh lease");
  }

  return {
    _id: lease.connectionId,
    userId: lease.userId,
    generation: lease.generation,
    tokenVersion: lease.tokenVersion,
    status: "connected",
    refreshLeaseOwner: lease.owner,
    refreshLeaseExpiresAt: { $gt: time },
  };
}

// No HTTP here. A false result means the lease/version no longer owns the write.
export async function persistSpotifyRefresh(input: {
  lease: SpotifyRefreshLease;
  result: SpotifyRefreshResult;
  config: EnabledSpotifyConfig;
  now?: () => Date;
}): Promise<boolean> {
  const time = currentTime(input.now);
  const expiry = input.result.accessExpiresAt;
  if (
    !(expiry instanceof Date) ||
    !Number.isFinite(expiry.getTime()) ||
    expiry.getTime() <= time.getTime()
  ) {
    throw new Error("Invalid Spotify access expiry");
  }

  const ownership = {
    userId: input.lease.userId,
    generation: input.lease.generation,
  };

  const accessToken = encryptSpotifyCredential(
    input.result.accessToken,
    { ...ownership, purpose: "access_token" },
    input.config,
  );

  const refreshToken = input.result.refreshToken === undefined
    ? undefined
    : encryptSpotifyCredential(
        input.result.refreshToken,
        { ...ownership, purpose: "refresh_token" },
        input.config,
      );

  const values = {
    accessToken,
    accessExpiresAt: new Date(expiry),
    tokenVersion: input.lease.tokenVersion + 1,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(input.result.grantedScopes === undefined
      ? {}
      : { grantedScopes: input.result.grantedScopes }),
  };

  return withSpotifyLinkGeneration(
    input.lease.userId,
    input.lease.generation,
    async session => {
      const changed = await SpotifyConnection.updateOne(
        leaseFilter(input.lease, currentTime(input.now)),
        {
          $set: values,
          $unset: {
            refreshLeaseOwner: "",
            refreshLeaseExpiresAt: "",
          },
        },
        { session, runValidators: true },
      );
      return changed.matchedCount === 1;
    },
  );
}

// A rejected POST did not issue usable replacement credentials. Preserve the
// connection and apply a cooldown. An uncertain POST may have rotated tokens:
// discard credentials rather than automatically replaying that refresh token.
export async function settleSpotifyRefreshFailure(input: {
  lease: SpotifyRefreshLease;
  error: SpotifyRefreshProviderError;
  now?: () => Date;
}): Promise<boolean> {
  const reauthorize =
    input.error.outcome === "invalid_grant" ||
    input.error.outcome === "ambiguous";

  return withSpotifyLinkGeneration(
    input.lease.userId,
    input.lease.generation,
    async session => {
      const time = currentTime(input.now);
      const filter = leaseFilter(input.lease, time);

      if (reauthorize) {
        const changed = await SpotifyConnection.updateOne(
          filter,
          {
            $set: {
              status: "reauthorization_required",
              tokenVersion: input.lease.tokenVersion + 1,
            },
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
        return changed.matchedCount === 1;
      }

      const retrySeconds = input.error.retryAfterSeconds;
      const delay = input.error.code === "rate_limited" &&
        typeof retrySeconds === "number" &&
        Number.isSafeInteger(retrySeconds) &&
        retrySeconds >= 0
        ? Math.max(1000, retrySeconds * 1000)
        : 1000;

      // Clamp only to JavaScript's maximum representable Date.
      const retryAt = new Date(Math.min(
        8_640_000_000_000_000,
        time.getTime() + delay,
      ));

      const changed = await SpotifyConnection.updateOne(
        filter,
        {
          $set: {
            tokenVersion: input.lease.tokenVersion + 1,
            refreshLeaseExpiresAt: retryAt,
          },
          $unset: { refreshLeaseOwner: "" },
        },
        { session, runValidators: true },
      );
      return changed.matchedCount === 1;
    },
  );
}
