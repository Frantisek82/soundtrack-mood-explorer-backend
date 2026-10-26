import { Types } from "mongoose";
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from "vitest";

import { openDeletionHistoryDatabase } from "@/lib/deletion-history/client";
import { getDeletionIdentityConfig } from "@/lib/deletion-history/config";
import { createDeletionIdentifier } from "@/lib/deletion-history/identifier";
import { reconcileDeletionCandidate } from "@/lib/deletion-history/reconcile";
import { runDeletionReconciliation } from "@/lib/deletion-history/reconcile-run";
import { createDeletionIntentStore } from "@/lib/deletion-history/store";
import Favorite from "@/models/Favorite";
import Playlist from "@/models/Playlist";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import User from "@/models/User";

let register: Awaited<ReturnType<typeof openDeletionHistoryDatabase>>;

async function fixture() {
  const user = await User.create({
    name: "Synthetic Reconciliation User",
    email: "synthetic-reconciliation@example.com",
    password: "test-only-password",
  });
  const userId = user._id.toString();
  const owner = new Types.ObjectId(userId);
  await Favorite.collection.insertOne({
    userId: owner, soundtrackId: new Types.ObjectId(),
  });
  await Playlist.create({ userId: owner, name: "Synthetic playlist" });
  // Native inserts intentionally avoid live credentials or provider configuration.
  await SpotifyConnection.collection.insertOne({
    userId: owner, accountId: "synthetic-reconciliation",
  });
  await SpotifyOAuthTransaction.collection.insertOne({
    userId: owner, stateHash: "a".repeat(64),
  });
  return userId;
}

async function record(userId: string) {
  const config = getDeletionIdentityConfig();
  const reference = {
    namespace: config.namespace,
    keyVersion: config.activeKeyVersion,
    digest: createDeletionIdentifier(userId, {
      namespace: config.namespace,
      keyVersion: config.activeKeyVersion,
      key: config.keys.get(config.activeKeyVersion)!,
    }),
  };
  await createDeletionIntentStore(register.database).recordPending(reference);
  return reference;
}

async function expectAbsent(userId: string) {
  await expect(User.exists({ _id: userId })).resolves.toBeNull();
  for (const model of [
    Favorite, Playlist, SpotifyConnection, SpotifyOAuthTransaction,
  ]) {
    await expect(model.exists({ userId })).resolves.toBeNull();
  }
}

async function expectPreserved(userId: string) {
  await expect(User.exists({ _id: userId })).resolves.not.toBeNull();
  for (const model of [
    Favorite, Playlist, SpotifyConnection, SpotifyOAuthTransaction,
  ]) {
    await expect(model.countDocuments({ userId })).resolves.toBe(1);
  }
}

describe("Accepted deletion candidate reconciliation", () => {
  beforeAll(async () => {
    register = await openDeletionHistoryDatabase();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("External HTTP forbidden during reconciliation"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  afterAll(async () => {
    if (register) await register.close();
  });

  it("preserves an account without an obligation and never inserts intent", async () => {
    const userId = await fixture();

    await expect(reconcileDeletionCandidate(userId)).resolves.toEqual({
      matched: false, completedObligations: 0,
    });
    await expectPreserved(userId);
    expect(await register.database.collection("accountdeletionintents")
      .countDocuments()).toBe(0);
  });

  it("cleans an existing account and completes its original pending intent", async () => {
    const userId = await fixture();
    const reference = await record(userId);
    const store = createDeletionIntentStore(register.database);
    const pending = await store.findExisting(reference);

    await expect(reconcileDeletionCandidate(userId)).resolves.toEqual({
      matched: true, completedObligations: 1,
    });
    await expectAbsent(userId);
    const completed = await store.findExisting(reference);
    expect(completed?.state).toBe("completed");
    expect(completed?.acceptedAt).toEqual(pending?.acceptedAt);

    await reconcileDeletionCandidate(userId);
    expect(await store.findExisting(reference)).toEqual(completed);
  });

  it("cleans orphaned data without recreating a User", async () => {
    const userId = await fixture();
    const reference = await record(userId);
    await User.deleteOne({ _id: userId });

    await reconcileDeletionCandidate(userId);

    await expectAbsent(userId);
    expect((await createDeletionIntentStore(register.database)
      .findExisting(reference))?.state).toBe("completed");
  });

  it("completes intent after cleanup already committed with an uncertain result", async () => {
    const userId = new Types.ObjectId().toHexString();
    const reference = await record(userId);

    await reconcileDeletionCandidate(userId);

    await expectAbsent(userId);
    expect((await createDeletionIntentStore(register.database)
      .findExisting(reference))?.state).toBe("completed");
  });

  it("retains pending intent and rolls back when cleanup fails", async () => {
    const userId = await fixture();
    const reference = await record(userId);
    vi.spyOn(Playlist, "deleteMany").mockImplementationOnce(() => {
      throw new Error("synthetic-private-cleanup-failure");
    });

    await expect(reconcileDeletionCandidate(userId))
      .rejects.toThrow("Deletion reconciliation incomplete");

    await expectPreserved(userId);
    expect((await createDeletionIntentStore(register.database)
      .findExisting(reference))?.state).toBe("pending");
  });

  it("matches an older key after the active key changes", async () => {
    const userId = await fixture();
    const reference = await record(userId);
    vi.stubEnv("DELETION_HISTORY_ACTIVE_KEY_VERSION", "test-v2");
    vi.stubEnv("DELETION_HISTORY_HMAC_KEYS", JSON.stringify({
      "test-v1": Buffer.alloc(32, 7).toString("base64"),
      "test-v2": Buffer.alloc(32, 8).toString("base64"),
    }));

    await reconcileDeletionCandidate(userId);

    await expectAbsent(userId);
    expect((await createDeletionIntentStore(register.database)
      .findExisting(reference))?.state).toBe("completed");
    expect(await register.database.collection("accountdeletionintents")
      .countDocuments()).toBe(1);
  });

  it("refuses missing historical keys before cleanup", async () => {
    const userId = await fixture();
    await record(userId);
    vi.stubEnv("DELETION_HISTORY_ACTIVE_KEY_VERSION", "test-v2");
    vi.stubEnv("DELETION_HISTORY_HMAC_KEYS", JSON.stringify({
      "test-v2": Buffer.alloc(32, 8).toString("base64"),
    }));

    await expect(reconcileDeletionCandidate(userId))
      .rejects.toThrow("Deletion reconciliation incomplete");
    await expectPreserved(userId);
  });

  it("rejects a malformed matching obligation before cleanup", async () => {
    const userId = await fixture();
    await record(userId);
    await register.database.collection("accountdeletionintents").updateOne(
      {}, { $set: { state: "invalid-synthetic-state" } },
    );

    await expect(reconcileDeletionCandidate(userId))
      .rejects.toThrow("Deletion reconciliation incomplete");
    await expectPreserved(userId);
  });

  function runInput() {
    return {
      expectedDatabaseName: "soundtrack-mood-explorer-test",
      expectedNamespace: "synthetic-test",
      confirmation: "reconcile-accepted-account-deletions",
    };
  }

  it("runs enumeration and reconciliation while preserving an unrelated account", async () => {
    const userId = await fixture();
    const reference = await record(userId);
    const retained = await User.create({
      name: "Retained Synthetic User",
      email: "retained-reconciliation@example.com",
      password: "test-only-password",
    });
    const retainedBefore = await User.collection.findOne({ _id: retained._id });

    await expect(runDeletionReconciliation(runInput())).resolves.toEqual({
      candidateCount: 2,
      matchedAccounts: 1,
      completedObligations: 1,
    });

    await expectAbsent(userId);
    expect(await User.collection.findOne({ _id: retained._id }))
      .toEqual(retainedBefore);
    expect((await createDeletionIntentStore(register.database)
      .findExisting(reference))?.state).toBe("completed");

    await expect(runDeletionReconciliation(runInput())).resolves.toEqual({
      candidateCount: 1,
      matchedAccounts: 0,
      completedObligations: 0,
    });
  });

  it("rejects malformed ownership during preflight before any account cleanup", async () => {
    const userId = await fixture();
    const reference = await record(userId);
    await Favorite.collection.insertOne({
      userId: "synthetic-malformed-owner",
      soundtrackId: new Types.ObjectId(),
    });

    await expect(runDeletionReconciliation(runInput()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");

    await expectPreserved(userId);
    expect((await createDeletionIntentStore(register.database)
      .findExisting(reference))?.state).toBe("pending");
  });

  it("resumes after completion recording fails following committed cleanup", async () => {
    const userId = await fixture();
    const reference = await record(userId);
    const store = createDeletionIntentStore(register.database);
    const pending = await store.findExisting(reference);

    // Register completion uses the driver's updateOne; generation fencing uses
    // findOneAndUpdate, so this failure occurs after application cleanup commits.
    const mongooseModule = await import("mongoose");
    const marker = vi.spyOn(mongooseModule.default.mongo.Collection.prototype, "updateOne")
      .mockRejectedValueOnce(new Error("synthetic-private-marker-failure"));

    await expect(runDeletionReconciliation(runInput()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    marker.mockRestore();

    await expectAbsent(userId);
    expect((await store.findExisting(reference))?.state).toBe("pending");
    expect((await store.findExisting(reference))?.acceptedAt)
      .toEqual(pending?.acceptedAt);

    // With no User or owner records left, enumeration cannot reverse the digest.
    // The candidate operation can still finish when a trusted candidate ID exists.
    await expect(reconcileDeletionCandidate(userId)).resolves.toEqual({
      matched: true,
      completedObligations: 1,
    });
    expect((await store.findExisting(reference))?.state).toBe("completed");
  });

});
