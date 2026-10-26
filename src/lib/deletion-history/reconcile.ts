import mongoose from "mongoose";

import { cleanupAcceptedAccountDeletion } from "@/lib/account-deletion";
import Favorite from "@/models/Favorite";
import Playlist from "@/models/Playlist";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import User from "@/models/User";

import { openDeletionHistoryDatabase } from "./client";
import { getDeletionIdentityConfig } from "./config";
import { createDeletionIdentifier } from "./identifier";
import {
  createDeletionIntentStore,
  type DeletionReference,
} from "./store";

export class DeletionReconciliationError extends Error {
  constructor() {
    super("Deletion reconciliation incomplete");
    this.name = "DeletionReconciliationError";
  }
}

// Internal candidate operation, not an HTTP endpoint or recovery-replay helper.
// Operator integration must first establish the intended application dataset.
// Uses the existing application connection and never inserts deletion intent.
export async function reconcileDeletionCandidate(userId: string): Promise<{
  matched: boolean;
  completedObligations: number;
}> {
  if (
    !/^[a-f0-9]{24}$/.test(userId) ||
    mongoose.connection.readyState !== 1
  ) throw new DeletionReconciliationError();

  const config = getDeletionIdentityConfig();
  const register = await openDeletionHistoryDatabase();

  try {
    // Reject missing historical keys before touching application data.
    const versions = await register.database
      .collection("accountdeletionintents")
      .distinct("keyVersion", { namespace: config.namespace });
    for (const version of versions) {
      if (typeof version !== "string" || !config.keys.has(version)) {
        throw new DeletionReconciliationError();
      }
    }

    const store = createDeletionIntentStore(register.database);
    const matched: DeletionReference[] = [];
    for (const [keyVersion, key] of config.keys) {
      const reference = {
        namespace: config.namespace,
        keyVersion,
        digest: createDeletionIdentifier(userId, {
          namespace: config.namespace,
          keyVersion,
          key,
        }),
      };
      if (await store.findExisting(reference)) matched.push(reference);
    }

    if (matched.length === 0) {
      return { matched: false, completedObligations: 0 };
    }

    // Completed obligations are also enforced; never infer absence from state.
    await cleanupAcceptedAccountDeletion(userId);

    // A stale-generation error or an uncertain cleanup result never reaches here.
    // Check all scoped collections before recording confirmed live completion.
    if (
      await User.exists({ _id: userId }) ||
      await Favorite.exists({ userId }) ||
      await Playlist.exists({ userId }) ||
      await SpotifyConnection.exists({ userId }) ||
      await SpotifyOAuthTransaction.exists({ userId })
    ) throw new DeletionReconciliationError();

    for (const reference of matched) {
      await store.markLiveCleanupCompleted(reference);
    }

    return {
      matched: true,
      completedObligations: matched.length,
    };
  } catch {
    // Earlier cleanup or completion updates may have committed. Retrying is safe.
    throw new DeletionReconciliationError();
  } finally {
    await register.close();
  }
}
