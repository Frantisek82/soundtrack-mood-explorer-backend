import SpotifyConnection from "@/models/SpotifyConnection";

import { withSpotifyLinkGeneration } from "./generation";

// For a rejected access-token version, not an in-flight refresh lease.
// A false result means a newer operation owns the connection.
// Provider HTTP must occur outside this transaction.
export async function requireSpotifyReauthorization(input: {
  userId: string;
  generation: number;
  tokenVersion: number;
}): Promise<boolean> {
  if (
    !Number.isSafeInteger(input.tokenVersion) ||
    input.tokenVersion < 0 ||
    input.tokenVersion >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Invalid Spotify token version");
  }

  return withSpotifyLinkGeneration(
    input.userId,
    input.generation,
    async session => {
      const changed = await SpotifyConnection.updateOne(
        {
          userId: input.userId,
          generation: input.generation,
          tokenVersion: input.tokenVersion,
          status: "connected",
          refreshLeaseOwner: { $exists: false },
        },
        {
          $set: {
            status: "reauthorization_required",
            tokenVersion: input.tokenVersion + 1,
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
    },
  );
}
