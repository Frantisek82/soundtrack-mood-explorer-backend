import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  openDeletionHistoryDatabase,
} from "@/lib/deletion-history/client";
import {
  createDeletionIntentStore,
  type DeletionIntent,
} from "@/lib/deletion-history/store";
import { DELETION_HISTORY_TEST_DATABASE } from "@/lib/deletion-history/target";

let replicaSet: MongoMemoryReplSet;
let handle: Awaited<ReturnType<typeof openDeletionHistoryDatabase>>;
let store: ReturnType<typeof createDeletionIntentStore>;

const reference = {
  namespace: "synthetic-test",
  keyVersion: "test-v1",
  digest: "a".repeat(64),
};

function records() {
  return handle.database.collection<DeletionIntent>("accountdeletionintents");
}

describe("Durable deletion intents", () => {
  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    handle = await openDeletionHistoryDatabase({
      DELETION_HISTORY_MONGODB_URI:
        replicaSet.getUri(DELETION_HISTORY_TEST_DATABASE),
    });
    store = createDeletionIntentStore(handle.database);
  });

  beforeEach(async () => {
    // This handle belongs only to the temporary replica set created above.
    await records().deleteMany({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      if (handle) await handle.close();
    } finally {
      if (replicaSet) await replicaSet.stop();
    }
  });

  it("persists minimal pending intent and preserves the first timestamp", async () => {
    const first = await store.recordPending(reference);
    const second = await store.recordPending(reference);

    expect(first.state).toBe("pending");
    expect(first.acceptedAt).toBeInstanceOf(Date);
    expect(second).toEqual(first);
    expect(await records().countDocuments()).toBe(1);
    expect(Object.keys(first).sort()).toEqual([
      "_id", "acceptedAt", "digest", "keyVersion",
      "namespace", "schemaVersion", "state",
    ]);
    expect(await records().findOne({ _id: first._id })).toEqual(first);
  });

  it("concurrent recording converges on one unchanged obligation", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.recordPending(reference)),
    );

    for (const result of results) expect(result).toEqual(results[0]);
    expect(await records().countDocuments()).toBe(1);
  });

  it("separates namespaces, key versions, and digests", async () => {
    await store.recordPending(reference);
    await store.recordPending({ ...reference, namespace: "another-test" });
    await store.recordPending({ ...reference, keyVersion: "test-v0" });
    await store.recordPending({ ...reference, digest: "b".repeat(64) });

    expect(await records().countDocuments()).toBe(4);
  });

  it("completes once and never regresses to pending on recording retry", async () => {
    const pending = await store.recordPending(reference);
    const completed = await store.markLiveCleanupCompleted(reference);

    expect(completed.state).toBe("completed");
    expect(completed.acceptedAt).toEqual(pending.acceptedAt);
    expect(completed.completedAt!.getTime())
      .toBeGreaterThanOrEqual(pending.acceptedAt.getTime());
    expect(await store.markLiveCleanupCompleted(reference)).toEqual(completed);
    expect(await store.recordPending(reference)).toEqual(completed);
    expect(await records().countDocuments()).toBe(1);
  });

  it("concurrent completion preserves one completion timestamp", async () => {
    await store.recordPending(reference);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.markLiveCleanupCompleted(reference)),
    );

    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0].state).toBe("completed");
  });

  it("does not create an obligation when completing a missing record", async () => {
    await expect(store.markLiveCleanupCompleted(reference))
      .rejects.toThrow("Deletion-history storage unavailable");
    expect(await records().countDocuments()).toBe(0);
  });

  it("rejects malformed stored obligations without repairing them silently", async () => {
    const pending = await store.recordPending(reference);
    await records().updateOne(
      { _id: pending._id },
      { $set: { schemaVersion: 2 } } as never,
    );

    await expect(store.recordPending(reference))
      .rejects.toThrow("Deletion-history storage unavailable");
    await expect(store.markLiveCleanupCompleted(reference))
      .rejects.toThrow("Deletion-history storage unavailable");
    expect((await records().findOne({ _id: pending._id }))?.schemaVersion).toBe(2);
  });

  it("preserves pending intent when the completion write fails", async () => {
    await store.recordPending(reference);
    vi.spyOn(mongoose.mongo.Collection.prototype, "updateOne")
      .mockRejectedValueOnce(new Error("private-write-details"));

    await expect(store.markLiveCleanupCompleted(reference))
      .rejects.toThrow("Deletion-history storage unavailable");
    expect((await records().findOne({}))?.state).toBe("pending");
  });

  it("sanitizes recording failures without deleting an existing obligation", async () => {
    const pending = await store.recordPending(reference);
    vi.spyOn(mongoose.mongo.Collection.prototype, "insertOne")
      .mockRejectedValueOnce(new Error("private-uncertain-write-details"));

    await expect(store.recordPending(reference))
      .rejects.toThrow("Deletion-history storage unavailable");
    expect(await records().findOne({ _id: pending._id })).toEqual(pending);
  });

  it("sanitizes a failed read after duplicate insertion", async () => {
    await store.recordPending(reference);
    vi.spyOn(mongoose.mongo.Collection.prototype, "findOne")
      .mockRejectedValueOnce(new Error("private-read-details"));

    await expect(store.recordPending(reference))
      .rejects.toThrow("Deletion-history storage unavailable");
    expect(await records().countDocuments()).toBe(1);
  });

  it.each([
    { ...reference, namespace: "invalid/namespace" },
    { ...reference, keyVersion: "" },
    { ...reference, digest: "not-a-digest" },
  ])("rejects malformed references before storing anything", async value => {
    await expect(store.recordPending(value))
      .rejects.toThrow("Deletion-history storage unavailable");
    expect(await records().countDocuments()).toBe(0);
  });
});
