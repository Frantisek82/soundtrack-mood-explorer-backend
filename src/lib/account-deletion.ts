import { executeRecordedAccountDeletion } from "./deletion-history/execute";
import { abortSpotifyOperationsBeforeGeneration } from "./spotify/operations";
import mongoose, { Types } from "mongoose";

import Favorite from "@/models/Favorite";
import Playlist from "@/models/Playlist";
import User from "@/models/User";

import { removeSpotifyData } from "./spotify/disconnect";
import {
  invalidateSpotifyLinkGeneration,
  SpotifyGenerationError,
} from "./spotify/generation";

// No Spotify configuration or provider request is needed to delete an account.
// Cookie cleanup belongs to the route and occurs only after this commits.
export async function deleteApplicationAccount(userId: string): Promise<number> {
  return executeRecordedAccountDeletion(
    userId,
    () => cleanupApplicationAccount(userId),
  );
}

async function cleanupApplicationAccount(userId: string): Promise<number> {
  const completed = await invalidateSpotifyLinkGeneration(
    userId,
    async session => {
      await removeSpotifyData(userId, session);

      await Favorite.deleteMany({
        userId: new Types.ObjectId(userId),
      }).session(session);

      await Playlist.deleteMany({
        userId: new Types.ObjectId(userId),
      }).session(session);
      const deleted = await User.deleteOne({ _id: userId }).session(session);
      if (deleted.deletedCount !== 1) {
        throw new SpotifyGenerationError("stale_spotify_generation");
      }
    },
  );

  abortSpotifyOperationsBeforeGeneration(userId, completed.generation);
  return completed.generation;
}

// Internal reconciliation primitive. Caller must first validate a durable
// obligation for this exact dataset/User. Never expose as a public endpoint.
// Does not insert intent or mark live completion.
export async function cleanupAcceptedAccountDeletion(
  userId: string,
): Promise<void> {
  if (!/^[a-f0-9]{24}$/.test(userId)) {
    throw new SpotifyGenerationError("invalid_generation_context");
  }

  if (await User.exists({ _id: userId })) {
    // Preserve generation fencing, invalid-counter rejection, and cancellation.
    // A concurrent disappearance is an error to retry, not proof of cleanup.
    await cleanupApplicationAccount(userId);
    return;
  }

  await mongoose.connection.transaction(async session => {
    // Never substitute orphan cleanup for a present User with invalid counters.
    if (await User.exists({ _id: userId }).session(session)) {
      throw new SpotifyGenerationError("stale_spotify_generation");
    }

    await removeSpotifyData(userId, session);
    await Favorite.deleteMany({
      userId: new Types.ObjectId(userId),
    }).session(session);
    await Playlist.deleteMany({
      userId: new Types.ObjectId(userId),
    }).session(session);
  }, {
    readPreference: "primary",
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
    maxCommitTimeMS: 5000,
  });

  // No User remains from which old-generation work can obtain a valid fence.
  // This cancels local work only; database fencing still rejects late results.
  abortSpotifyOperationsBeforeGeneration(userId, Number.MAX_SAFE_INTEGER);
}
