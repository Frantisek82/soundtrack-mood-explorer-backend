import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from "vitest";

import {
  DeletionHistoryStorageError,
  openDeletionHistoryDatabase,
} from "@/lib/deletion-history/client";
import { DeletionHistoryConfigError } from "@/lib/deletion-history/config";
import { DELETION_HISTORY_TEST_DATABASE } from "@/lib/deletion-history/target";

let replicaSet: MongoMemoryReplSet;
let uri: string;

describe("Independent deletion-history client", () => {
  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    uri = replicaSet.getUri(DELETION_HISTORY_TEST_DATABASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (replicaSet) await replicaSet.stop();
  });

  it("owns a separate connection and preserves the application connection", async () => {
    const applicationClient = mongoose.connection.getClient();
    const applicationName = mongoose.connection.name;
    const handle = await openDeletionHistoryDatabase({
      DELETION_HISTORY_MONGODB_URI: uri,
    });

    try {
      expect(handle.database.databaseName).toBe(DELETION_HISTORY_TEST_DATABASE);
      await handle.database.collection("synthetic").insertOne({ value: "test-only" });
      expect(await handle.database.collection("synthetic").countDocuments()).toBe(1);
      expect(mongoose.connection.getClient()).toBe(applicationClient);
      expect(mongoose.connection.name).toBe(applicationName);
    } finally {
      await handle.close();
    }

    await handle.close();
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.getClient()).toBe(applicationClient);
    await expect(mongoose.connection.db!.command({ ping: 1 }))
      .resolves.toMatchObject({ ok: 1 });
  });

  it.each([
    "",
    "mongodb://remote.example.com:27017/sme-deletion-history-test",
    "mongodb://127.0.0.1:27017/soundtrack-mood-explorer-test",
    "mongodb+srv://synthetic:synthetic@register.example.mongodb.net/sme-deletion-history",
  ])("rejects unsafe targets before connecting, even with a mode override", async value => {
    const connect = vi.spyOn(mongoose.mongo.MongoClient.prototype, "connect");

    await expect(openDeletionHistoryDatabase({
      NODE_ENV: "production",
      DELETION_HISTORY_MONGODB_URI: value,
    })).rejects.toBeInstanceOf(DeletionHistoryConfigError);

    expect(connect).not.toHaveBeenCalled();
  });

  it("disposes a failed connection without exposing driver details", async () => {
    vi.spyOn(mongoose.mongo.MongoClient.prototype, "connect")
      .mockRejectedValueOnce(new Error("private-driver-details"));
    const close = vi.spyOn(mongoose.mongo.MongoClient.prototype, "close")
      .mockResolvedValueOnce();

    await expect(openDeletionHistoryDatabase({
      DELETION_HISTORY_MONGODB_URI: uri,
    })).rejects.toThrow("Deletion-history storage unavailable");
    expect(close).toHaveBeenCalledOnce();
  });

  it("sanitizes failure even when connection disposal also fails", async () => {
    vi.spyOn(mongoose.mongo.MongoClient.prototype, "connect")
      .mockRejectedValueOnce(new Error("private-connection-details"));
    vi.spyOn(mongoose.mongo.MongoClient.prototype, "close")
      .mockRejectedValueOnce(new Error("private-close-details"));

    await expect(openDeletionHistoryDatabase({
      DELETION_HISTORY_MONGODB_URI: uri,
    })).rejects.toBeInstanceOf(DeletionHistoryStorageError);
  });

  it("bounds operations and uses majority reads and acknowledged journaled writes", async () => {
    const connect = vi.spyOn(mongoose.mongo.MongoClient.prototype, "connect")
      .mockImplementationOnce(async function (
        this: InstanceType<typeof mongoose.mongo.MongoClient>,
      ) {
        expect(this.options).toMatchObject({
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000,
          socketTimeoutMS: 5000,
          waitQueueTimeoutMS: 5000,
          timeoutMS: 5000,
          maxPoolSize: 3,
          retryReads: false,
          retryWrites: false,
          readPreference: { mode: "primary" },
          readConcern: { level: "majority" },
          writeConcern: { w: "majority", j: true, wtimeout: 5000 },
        });
        return this;
      });

    const handle = await openDeletionHistoryDatabase({
      DELETION_HISTORY_MONGODB_URI: uri,
    });
    try {
      expect(connect).toHaveBeenCalledOnce();
    } finally {
      await handle.close();
    }
  });
});
