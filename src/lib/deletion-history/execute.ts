import { openDeletionHistoryDatabase } from "./client";
import { getDeletionIdentityConfig } from "./config";
import { createDeletionIdentifier } from "./identifier";
import { createDeletionIntentStore } from "./store";

// Invoke only after authentication. cleanup must resolve only after live commit.
// Both pending and completed records remain recovery deletion obligations.
export async function executeRecordedAccountDeletion<T>(
  userId: string,
  cleanup: () => Promise<T>,
): Promise<T> {
  const config = getDeletionIdentityConfig();
  const key = config.keys.get(config.activeKeyVersion)!;
  const reference = {
    namespace: config.namespace,
    keyVersion: config.activeKeyVersion,
    digest: createDeletionIdentifier(userId, {
      namespace: config.namespace,
      keyVersion: config.activeKeyVersion,
      key,
    }),
  };

  const handle = await openDeletionHistoryDatabase();
  try {
    const store = createDeletionIntentStore(handle.database);
    await store.recordPending(reference);

    const result = await cleanup();

    try {
      await store.markLiveCleanupCompleted(reference);
    } catch {
      // Live cleanup committed. The durable intent still requires recovery replay.
      // A completion-marker failure cannot turn that commit into a rollback.
    }

    return result;
  } finally {
    try {
      await handle.close();
    } catch {
      // Disposal must not replace a cleanup failure or a committed result.
    }
  }
}
