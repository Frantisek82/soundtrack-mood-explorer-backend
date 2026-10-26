import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from "vitest";

import { openDeletionHistoryDatabase } from "@/lib/deletion-history/client";
import { getDeletionIdentityConfig } from "@/lib/deletion-history/config";
import { createDeletionIdentifier } from "@/lib/deletion-history/identifier";
import { openRecoveryTestDatabase } from "@/lib/deletion-history/recovery-client";
import {
  type SyntheticRecoveryCoverage,
} from "@/lib/deletion-history/recovery-coverage";
import { replaySyntheticRecovery } from "@/lib/deletion-history/recovery-replay";
import { RECOVERY_TEST_DATABASE } from "@/lib/deletion-history/recovery-target";
import { createDeletionIntentStore } from "@/lib/deletion-history/store";

let replicaSet: MongoMemoryReplSet;
let recovery: Awaited<ReturnType<typeof openRecoveryTestDatabase>>;
let register: Awaited<ReturnType<typeof openDeletionHistoryDatabase>>;
let recoveryUri: string;

function environment() {
  return {
    ...process.env,
    NODE_ENV: "test",
    RECOVERY_TEST_OPT_IN: "isolated-synthetic-recovery",
    RECOVERY_MONGODB_URI: recoveryUri,
  };
}

function evidence(): SyntheticRecoveryCoverage {
  const now = Date.now();
  return {
    schemaVersion: 1,
    namespace: "synthetic-test",
    coverageStartedAt: new Date(now - 20_000),
    copyCapturedAt: new Date(now - 10_000),
    deletionBarrierAt: new Date(now + 1_000),
    historyVerifiedThrough: new Date(now + 1_000),
    expectedHistoryEpoch: "synthetic-history-1",
    observedHistoryEpoch: "synthetic-history-1",
    requiredKeyVersions: ["test-v1"],
    unresolvedInterruptions: [],
  };
}

async function obligation(userId: mongoose.Types.ObjectId, completed = false) {
  const config = getDeletionIdentityConfig();
  const reference = {
    namespace: config.namespace,
    keyVersion: config.activeKeyVersion,
    digest: createDeletionIdentifier(userId.toHexString(), {
      namespace: config.namespace,
      keyVersion: config.activeKeyVersion,
      key: config.keys.get(config.activeKeyVersion)!,
    }),
  };
  const store = createDeletionIntentStore(register.database);
  await store.recordPending(reference);
  if (completed) await store.markLiveCleanupCompleted(reference);
}

async function fixture() {
  const deleted = new mongoose.Types.ObjectId();
  const orphan = new mongoose.Types.ObjectId();
  const retained = new mongoose.Types.ObjectId();
  const track = new mongoose.Types.ObjectId();
  const database = recovery.database;

  await database.collection("users").insertMany([
    { _id: deleted, synthetic: "deleted" },
    { _id: retained, synthetic: "retained" },
  ]);
  for (const userId of [deleted, orphan, retained]) {
    await database.collection("favorites").insertOne({ userId, soundtrackId: track });
    await database.collection("playlists").insertOne({
      userId, name: "Synthetic playlist", soundtracks: [track],
    });
    await database.collection("spotifyconnections").insertOne({ userId });
    await database.collection("spotifyoauthtransactions").insertOne({ userId });
  }
  await database.collection("soundtracks").insertOne({
    _id: track, title: "Synthetic shared track",
  });
  await obligation(deleted);
  await obligation(orphan, true);
  return { deleted, orphan, retained, track };
}

async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const name of [
    "users", "favorites", "playlists", "soundtracks",
    "spotifyconnections", "spotifyoauthtransactions",
  ]) {
    result[name] = await recovery.database.collection(name)
      .find({}).sort({ _id: 1 }).toArray();
  }
  return result;
}

describe("Synthetic quarantined recovery replay", () => {
  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    recoveryUri = replicaSet.getUri(RECOVERY_TEST_DATABASE);
    recovery = await openRecoveryTestDatabase(environment());
    register = await openDeletionHistoryDatabase();
  });

  beforeEach(async () => {
    for (const collection of await recovery.database.collections()) {
      await collection.deleteMany({});
    }
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("External HTTP forbidden during recovery"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  afterAll(async () => {
    try {
      if (register) await register.close();
    } finally {
      try {
        if (recovery) await recovery.close();
      } finally {
        if (replicaSet) await replicaSet.stop();
      }
    }
  });

  it("replays pending and completed obligations including orphaned owners", async () => {
    const data = await fixture();
    const before = await snapshot();
    const history = await register.database.collection("accountdeletionintents")
      .find({}).sort({ _id: 1 }).toArray();

    const result = await replaySyntheticRecovery(evidence(), environment());
    expect(result).toEqual({
      quarantined: true, processedAccounts: 2, spotifySanitized: true,
    });

    const after = await snapshot();
    for (const name of ["users", "favorites", "playlists"]) {
      expect(after[name]).toEqual(
        (before[name] as Record<string, unknown>[]).filter(record =>
          String(name === "users" ? record._id : record.userId) ===
            data.retained.toHexString()),
      );
    }
    expect(after.soundtracks).toEqual(before.soundtracks);
    expect(after.spotifyconnections).toEqual([]);
    expect(after.spotifyoauthtransactions).toEqual([]);
    expect(await register.database.collection("accountdeletionintents")
      .find({}).sort({ _id: 1 }).toArray()).toEqual(history);

    const repeated = await replaySyntheticRecovery(evidence(), environment());
    expect(repeated.quarantined).toBe(true);
    expect(repeated.processedAccounts).toBe(0);
    expect(await snapshot()).toEqual(after);
  });

  it("rejects incomplete coverage before modifying recovery data", async () => {
    await fixture();
    const before = await snapshot();

    await expect(replaySyntheticRecovery({
      ...evidence(), unresolvedInterruptions: ["synthetic-gap"],
    }, environment())).rejects.toThrow(
      "Deletion-history coverage is incomplete or unverifiable",
    );
    expect(await snapshot()).toEqual(before);
  });

  it("rejects an obligation with an undeclared key before any writes", async () => {
    await fixture();
    const before = await snapshot();
    await register.database.collection("accountdeletionintents").updateOne(
      {}, { $set: { keyVersion: "missing-historical-key" } },
    );

    await expect(replaySyntheticRecovery(evidence(), environment()))
      .rejects.toThrow("Recovery replay failed; target remains quarantined");
    expect(await snapshot()).toEqual(before);
  });

  it("rejects malformed ownership before any writes", async () => {
    await fixture();
    await recovery.database.collection("favorites").insertOne({
      userId: "malformed-synthetic-owner",
    });
    const before = await snapshot();

    await expect(replaySyntheticRecovery(evidence(), environment()))
      .rejects.toThrow("Recovery replay failed; target remains quarantined");
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back the current account transaction on cleanup failure", async () => {
    await fixture();
    const before = await snapshot();
    vi.spyOn(mongoose.mongo.Collection.prototype, "deleteOne")
      .mockRejectedValueOnce(new Error("synthetic-private-cleanup-details"));

    await expect(replaySyntheticRecovery(evidence(), environment()))
      .rejects.toThrow("Recovery replay failed; target remains quarantined");
    expect(await snapshot()).toEqual(before);
  });

  it("refuses an unreadable register without changing recovery data", async () => {
    await fixture();
    const before = await snapshot();

    vi.spyOn(mongoose.mongo.Collection.prototype, "find")
      .mockImplementationOnce(() => {
        throw new Error("synthetic-private-register-read-failure");
      });

    await expect(replaySyntheticRecovery(evidence(), environment()))
      .rejects.toThrow("Recovery replay failed; target remains quarantined");
    expect(await snapshot()).toEqual(before);
  });
});
