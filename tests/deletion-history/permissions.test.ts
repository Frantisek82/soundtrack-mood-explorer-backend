import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDeletionIntentStore } from "@/lib/deletion-history/store";
import { DELETION_HISTORY_TEST_DATABASE } from "@/lib/deletion-history/target";

type Client = InstanceType<typeof mongoose.mongo.MongoClient>;

let replicaSet: MongoMemoryReplSet | undefined;
let administrator: Client | undefined;
let writer: Client | undefined;

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
  });

  afterAll(async () => {
    try {
      await writer?.close();
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
});
