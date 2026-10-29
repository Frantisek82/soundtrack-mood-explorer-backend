import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDeletionIdentityConfig } from "@/lib/deletion-history/config";
import { createDeletionIdentifier } from "@/lib/deletion-history/identifier";
import {
  reconcileDeletionCandidateUsingRegister,
} from "@/lib/deletion-history/reconcile";
import User from "@/models/User";

import { createDeletionIntentStore } from "@/lib/deletion-history/store";
import { DELETION_HISTORY_TEST_DATABASE } from "@/lib/deletion-history/target";

type Client = InstanceType<typeof mongoose.mongo.MongoClient>;

let replicaSet: MongoMemoryReplSet | undefined;
let administrator: Client | undefined;
let writer: Client | undefined;
let reader: Client | undefined;
let reconciler: Client | undefined;

const databaseName = DELETION_HISTORY_TEST_DATABASE;
const collectionName = "accountdeletionintents";
const reference = {
  namespace: "synthetic-test",
  keyVersion: "test-v1",
  digest: "a".repeat(64),
};

describe("Deletion register collection permissions", () => {
  beforeAll(async () => {
    // Credentials and users exist only in this temporary local replica set.
    replicaSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        ip: "127.0.0.1",
        storageEngine: "wiredTiger",
        auth: {
          enable: true,
          customRootName: "synthetic-root",
          customRootPwd: "synthetic-root-password",
        },
      },
    });

    const uri = replicaSet.getUri(databaseName);
    administrator = new mongoose.mongo.MongoClient(uri, {
      auth: {
        username: "synthetic-root",
        password: "synthetic-root-password",
      },
      authSource: "admin",
      serverSelectionTimeoutMS: 5000,
    });
    await administrator.connect();

    const database = administrator.db(databaseName);
    await database.createCollection(collectionName);
    await database.collection("unrelated").insertOne({ synthetic: true });
    await administrator.db("synthetic-other").collection("records")
      .insertOne({ synthetic: true });

    await database.command({
      createRole: "synthetic-intent-writer",
      privileges: [{
        resource: { db: databaseName, collection: collectionName },
        actions: ["find", "insert", "update"],
      }],
      roles: [],
    });
    await database.command({
      createUser: "synthetic-writer",
      pwd: "synthetic-writer-password",
      roles: [{ role: "synthetic-intent-writer", db: databaseName }],
    });

    writer = new mongoose.mongo.MongoClient(uri, {
      auth: {
        username: "synthetic-writer",
        password: "synthetic-writer-password",
      },
      authSource: databaseName,
      serverSelectionTimeoutMS: 5000,
      retryReads: false,
      retryWrites: false,
      readConcern: { level: "majority" },
      writeConcern: { w: "majority", journal: true, wtimeoutMS: 5000 },
    });
    await writer.connect();

    await database.command({
      createRole: "synthetic-recovery-reader",
      privileges: [{
        resource: { db: databaseName, collection: collectionName },
        actions: ["find"],
      }],
      roles: [],
    });
    await database.command({
      createUser: "synthetic-reader",
      pwd: "synthetic-reader-password",
      roles: [{ role: "synthetic-recovery-reader", db: databaseName }],
    });

    reader = new mongoose.mongo.MongoClient(uri, {
      auth: {
        username: "synthetic-reader",
        password: "synthetic-reader-password",
      },
      authSource: databaseName,
      serverSelectionTimeoutMS: 5000,
      retryReads: false,
      retryWrites: false,
      readConcern: { level: "majority" },
    });
    await reader.connect();

    await database.command({
      createRole: "synthetic-reconciler",
      privileges: [{
        resource: { db: databaseName, collection: collectionName },
        actions: ["find", "update"],
      }],
      roles: [],
    });
    await database.command({
      createUser: "synthetic-reconciler",
      pwd: "synthetic-reconciler-password",
      roles: [{ role: "synthetic-reconciler", db: databaseName }],
    });
    reconciler = new mongoose.mongo.MongoClient(uri, {
      auth: {
        username: "synthetic-reconciler",
        password: "synthetic-reconciler-password",
      },
      authSource: databaseName,
      serverSelectionTimeoutMS: 5000,
      retryReads: false,
      retryWrites: false,
      readConcern: { level: "majority" },
      writeConcern: { w: "majority", journal: true, wtimeoutMS: 5000 },
    });
    await reconciler.connect();
  });

  afterAll(async () => {
    try {
      try {
        try {
          await reconciler?.close();
        } finally {
          await reader?.close();
        }
      } finally {
        await writer?.close();
      }
    } finally {
      try {
        await administrator?.close();
      } finally {
        await replicaSet?.stop();
      }
    }
  });

  it("supports recording, duplicate retries, reads, and completion", async () => {
    const store = createDeletionIntentStore(writer!.db(databaseName));

    expect(await store.findExisting(reference)).toBeNull();
    const pending = await store.recordPending(reference);
    expect(pending.state).toBe("pending");
    expect(await store.recordPending(reference)).toEqual(pending);
    expect(await store.findExisting(reference)).toEqual(pending);

    const completed = await store.markLiveCleanupCompleted(reference);
    expect(completed.state).toBe("completed");
    expect(completed.acceptedAt).toEqual(pending.acceptedAt);
    expect(await store.markLiveCleanupCompleted(reference)).toEqual(completed);
    expect(await store.recordPending(reference)).toEqual(completed);
  });

  it("denies deletion and collection or database destruction", async () => {
    const database = writer!.db(databaseName);

    await expect(database.collection(collectionName).deleteMany({}))
      .rejects.toMatchObject({ code: 13 });
    await expect(database.command({ drop: collectionName }))
      .rejects.toMatchObject({ code: 13 });
    await expect(database.command({ dropDatabase: 1 }))
      .rejects.toMatchObject({ code: 13 });

    expect(await administrator!.db(databaseName)
      .collection(collectionName).countDocuments()).toBe(1);
  });

  it("denies reads and writes outside the permitted collection", async () => {
    const collections = [
      writer!.db(databaseName).collection("unrelated"),
      writer!.db("synthetic-other").collection("records"),
    ];

    for (const collection of collections) {
      await expect(collection.findOne({}))
        .rejects.toMatchObject({ code: 13 });
      await expect(collection.insertOne({ unauthorized: true }))
        .rejects.toMatchObject({ code: 13 });
      await expect(collection.updateOne({}, { $set: { unauthorized: true } }))
        .rejects.toMatchObject({ code: 13 });
    }
  });

  it("denies granting itself broader privileges", async () => {
    await expect(writer!.db(databaseName).command({
      grantRolesToUser: "synthetic-writer",
      roles: [{ role: "readWrite", db: databaseName }],
    })).rejects.toMatchObject({ code: 13 });
  });

  it("allows recovery reads but denies register mutations", async () => {
    const database = reader!.db(databaseName);
    const records = database.collection(collectionName);
    const obligations = await records.find({
      namespace: reference.namespace,
    }).toArray();

    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({
      namespace: reference.namespace,
      digest: reference.digest,
      state: "completed",
    });

    await expect(records.insertOne({ synthetic: true }))
      .rejects.toMatchObject({ code: 13 });
    await expect(records.updateOne({}, { $set: { state: "pending" } }))
      .rejects.toMatchObject({ code: 13 });
    await expect(records.deleteMany({}))
      .rejects.toMatchObject({ code: 13 });
    await expect(database.command({ drop: collectionName }))
      .rejects.toMatchObject({ code: 13 });
    await expect(database.command({ dropDatabase: 1 }))
      .rejects.toMatchObject({ code: 13 });

    expect(await records.find({
      namespace: reference.namespace,
    }).toArray()).toEqual(obligations);
  });

  it("denies recovery-reader access elsewhere and privilege escalation", async () => {
    for (const collection of [
      reader!.db(databaseName).collection("unrelated"),
      reader!.db("synthetic-other").collection("records"),
    ]) {
      await expect(collection.findOne({}))
        .rejects.toMatchObject({ code: 13 });
      await expect(collection.insertOne({ unauthorized: true }))
        .rejects.toMatchObject({ code: 13 });
    }

    await expect(reader!.db(databaseName).command({
      grantRolesToUser: "synthetic-reader",
      roles: [{ role: "readWrite", db: databaseName }],
    })).rejects.toMatchObject({ code: 13 });
  });

  it("reconciles and retries with only register find and update permissions", async () => {
    const user = await User.create({
      name: "Synthetic Restricted Reconciliation",
      email: "restricted-reconciliation@example.com",
      password: "test-only-password",
    });
    const userId = user._id.toString();
    const config = getDeletionIdentityConfig();
    const obligation = {
      namespace: config.namespace,
      keyVersion: config.activeKeyVersion,
      digest: createDeletionIdentifier(userId, {
        namespace: config.namespace,
        keyVersion: config.activeKeyVersion,
        key: config.keys.get(config.activeKeyVersion)!,
      }),
    };
    const adminStore = createDeletionIntentStore(
      administrator!.db(databaseName),
    );
    const pending = await adminStore.recordPending(obligation);
    const database = reconciler!.db(databaseName);
    const fetchGuard = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("External HTTP forbidden during reconciliation"),
    );

    try {
      await expect(reconcileDeletionCandidateUsingRegister(userId, database))
        .resolves.toEqual({ matched: true, completedObligations: 1 });
      expect(await User.exists({ _id: userId })).toBeNull();

      const completed = await adminStore.findExisting(obligation);
      expect(completed?.state).toBe("completed");
      expect(completed?.acceptedAt).toEqual(pending.acceptedAt);

      await expect(reconcileDeletionCandidateUsingRegister(userId, database))
        .resolves.toEqual({ matched: true, completedObligations: 1 });
      expect(await adminStore.findExisting(obligation)).toEqual(completed);
      expect(fetchGuard).not.toHaveBeenCalled();
    } finally {
      fetchGuard.mockRestore();
    }
  });

  it("denies reconciler insertion, destruction, unrelated access, and escalation", async () => {
    const database = reconciler!.db(databaseName);
    const records = database.collection(collectionName);

    await expect(records.insertOne({ synthetic: true }))
      .rejects.toMatchObject({ code: 13 });
    await expect(records.deleteMany({}))
      .rejects.toMatchObject({ code: 13 });
    await expect(database.command({ drop: collectionName }))
      .rejects.toMatchObject({ code: 13 });
    await expect(database.command({ dropDatabase: 1 }))
      .rejects.toMatchObject({ code: 13 });

    for (const collection of [
      database.collection("unrelated"),
      reconciler!.db("synthetic-other").collection("records"),
    ]) {
      await expect(collection.findOne({}))
        .rejects.toMatchObject({ code: 13 });
      await expect(collection.updateOne({}, { $set: { unauthorized: true } }))
        .rejects.toMatchObject({ code: 13 });
    }

    await expect(database.command({
      grantRolesToUser: "synthetic-reconciler",
      roles: [{ role: "readWrite", db: databaseName }],
    })).rejects.toMatchObject({ code: 13 });
  });
});
