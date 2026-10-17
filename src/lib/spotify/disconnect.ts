import { abortSpotifyOperationsBeforeGeneration } from "./operations";
import type { ClientSession } from "mongoose";

import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";

import { invalidateSpotifyLinkGeneration } from "./generation";

// Used only inside the caller's generation-invalidation transaction.
// Keep operations sequential on the supplied MongoDB session.
export async function removeSpotifyData(
  userId: string,
  session: ClientSession,
): Promise<void> {
  await SpotifyConnection.deleteMany({ userId }).session(session);
  await SpotifyOAuthTransaction.deleteMany({ userId }).session(session);
}

// Resolves only after cleanup and generation invalidation commit.
// Repeated disconnects are safe; the internal generation continues increasing.
export async function disconnectSpotifyAccount(userId: string): Promise<number> {
  const completed = await invalidateSpotifyLinkGeneration(
    userId,
    async session => {
      await removeSpotifyData(userId, session);
    },
  );

  abortSpotifyOperationsBeforeGeneration(userId, completed.generation);
  return completed.generation;
}
