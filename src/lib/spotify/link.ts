import SpotifyConnection from "@/models/SpotifyConnection";

import type { SpotifyConfig } from "./config";
import { encryptSpotifyCredential } from "./encryption";
import {
  SpotifyGenerationError,
  withSpotifyLinkGeneration,
} from "./generation";
import type { SpotifyAuthorization } from "./provider";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

export class SpotifyAccountConflictError extends Error {
  constructor() {
    super("account_conflict");
    this.name = "SpotifyAccountConflictError";
  }
}

// Backend only. Provider HTTP must finish before calling this function.
// No credential-bearing result is returned.
export async function persistSpotifyAccountLink(input: {
  userId: string;
  generation: number;
  authorization: SpotifyAuthorization;
  config: EnabledSpotifyConfig;
}): Promise<void> {
  const authorization = input.authorization;
  const ownership = {
    userId: input.userId,
    generation: input.generation,
  };

  const accessToken = encryptSpotifyCredential(
    authorization.accessToken,
    { ...ownership, purpose: "access_token" },
    input.config,
  );
  const refreshToken = encryptSpotifyCredential(
    authorization.refreshToken,
    { ...ownership, purpose: "refresh_token" },
    input.config,
  );

  const originalAuthorizedAt = new Date(authorization.authorizedAt.getTime());
  const estimatedRefreshExpiry = new Date(
    originalAuthorizedAt.getTime() + 180 * 24 * 60 * 60 * 1000,
  );

  if (
    !Number.isFinite(originalAuthorizedAt.getTime()) ||
    !Number.isFinite(estimatedRefreshExpiry.getTime()) ||
    !Number.isFinite(authorization.accessExpiresAt.getTime()) ||
    authorization.accessExpiresAt.getTime() <= originalAuthorizedAt.getTime()
  ) {
    throw new Error("Invalid Spotify authorization lifetime");
  }

  const values = {
    userId: input.userId,
    accountId: authorization.accountId,
    displayName: authorization.displayName,
    status: "connected" as const,
    grantedScopes: authorization.grantedScopes,
    originalAuthorizedAt,
    estimatedRefreshExpiry,
    accessExpiresAt: authorization.accessExpiresAt,
    accessToken,
    refreshToken,
    generation: input.generation,
  };

  try {
    await withSpotifyLinkGeneration(
      input.userId,
      input.generation,
      async (session) => {
        const existing = await SpotifyConnection.findOne({
          userId: input.userId,
        }).session(session);

        if (existing && existing.accountId !== authorization.accountId) {
          throw new SpotifyAccountConflictError();
        }

        if (existing && existing.generation !== input.generation) {
          throw new SpotifyGenerationError("stale_spotify_generation");
        }

        const otherOwner = await SpotifyConnection.findOne({
          accountId: authorization.accountId,
          userId: { $ne: input.userId },
        })
          .select("_id")
          .session(session);

        if (otherOwner) {
          throw new SpotifyAccountConflictError();
        }

        if (!existing) {
          await SpotifyConnection.insertMany(
            [
              {
                ...values,
                tokenVersion: 0,
              },
            ],
            { session, ordered: true },
          );
          return;
        }

        if (
          !Number.isSafeInteger(existing.tokenVersion) ||
          existing.tokenVersion < 0 ||
          existing.tokenVersion >= Number.MAX_SAFE_INTEGER
        ) {
          throw new SpotifyGenerationError("stale_spotify_generation");
        }

        const updated = await SpotifyConnection.updateOne(
          {
            _id: existing._id,
            userId: input.userId,
            accountId: authorization.accountId,
            generation: input.generation,
            tokenVersion: existing.tokenVersion,
          },
          {
            $set: {
              ...values,
              tokenVersion: existing.tokenVersion + 1,
            },
            $unset: {
              refreshLeaseOwner: "",
              refreshLeaseExpiresAt: "",
            },
          },
          { session, runValidators: true },
        );

        if (updated.matchedCount !== 1) {
          throw new SpotifyGenerationError("stale_spotify_generation");
        }
      },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new SpotifyAccountConflictError();
    }
    throw error;
  }
}
