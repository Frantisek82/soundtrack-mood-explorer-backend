import { executeRecordedAccountDeletion } from "./deletion-history/execute";
import { abortSpotifyOperationsBeforeGeneration } from "./spotify/operations";
import { Types } from "mongoose";

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
