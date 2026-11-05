import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from "vitest";

import { openDeletionHistoryDatabase } from "@/lib/deletion-history/client";
import {
  openRecoveryTestDatabase,
  RecoveryStorageError,
} from "@/lib/deletion-history/recovery-client";
import {
  RECOVERY_TEST_DATABASE,
  RecoveryTargetError,
} from "@/lib/deletion-history/recovery-target";

let replicaSet: MongoMemoryReplSet;
let recoveryUri: string;

function environment() {
  return {
    NODE_ENV: "test",
    RECOVERY_TEST_OPT_IN: "isolated-synthetic-recovery",
    RECOVERY_MONGODB_URI: recoveryUri,
    MONGODB_URI: process.env.MONGODB_URI,
    DELETION_HISTORY_MONGODB_URI: process.env.DELETION_HISTORY_MONGODB_URI,
  };
}

describe("Independent synthetic recovery connection", () => {
  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    recoveryUri = replicaSet.getUri(RECOVERY_TEST_DATABASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (replicaSet) await replicaSet.stop();
  });

  it("writes only to recovery and preserves both protected connections", async () => {
    const applicationClient = mongoose.connection.getClient();
    const register = await openDeletionHistoryDatabase();
    let recovery: Awaited<ReturnType<typeof openRecoveryTestDatabase>> | undefined;

    try {
      recovery = await openRecoveryTestDatabase(environment());
      expect(recovery.database.databaseName).toBe(RECOVERY_TEST_DATABASE);
      await recovery.database.collection("recoveryclientprobe")
        .insertOne({ synthetic: true });

      expect(await recovery.database.collection("recoveryclientprobe")
        .countDocuments()).toBe(1);
      expect(await register.database.collection("recoveryclientprobe")
        .countDocuments()).toBe(0);
      expect(await mongoose.connection.db!.collection("recoveryclientprobe")
        .countDocuments()).toBe(0);

      await recovery.close();
      await recovery.close();

      expect(mongoose.connection.getClient()).toBe(applicationClient);
      await expect(mongoose.connection.db!.command({ ping: 1 }))
        .resolves.toMatchObject({ ok: 1 });
      await expect(register.database.command({ ping: 1 }))
        .resolves.toMatchObject({ ok: 1 });
    } finally {
      try {
        if (recovery) await recovery.close();
      } finally {
        await register.close();
      }
    }
  });

  it("rejects a protected target before attempting a connection", async () => {
    const connect = vi.spyOn(mongoose.mongo.MongoClient.prototype, "connect");

    await expect(openRecoveryTestDatabase({
      ...environment(),
      RECOVERY_MONGODB_URI: process.env.MONGODB_URI,
    })).rejects.toBeInstanceOf(RecoveryTargetError);
    expect(connect).not.toHaveBeenCalled();
  });

  it("closes a failed connection and sanitizes driver errors", async () => {
    vi.spyOn(mongoose.mongo.MongoClient.prototype, "connect")
      .mockRejectedValueOnce(new Error("synthetic-private-driver-details"));
    const close = vi.spyOn(mongoose.mongo.MongoClient.prototype, "close")
      .mockResolvedValueOnce();

    await expect(openRecoveryTestDatabase(environment()))
      .rejects.toThrow("Quarantined recovery storage unavailable");
    expect(close).toHaveBeenCalledOnce();
  });

  it("sanitizes connection failure even if disposal also fails", async () => {
    vi.spyOn(mongoose.mongo.MongoClient.prototype, "connect")
      .mockRejectedValueOnce(new Error("synthetic-private-connect-details"));
    vi.spyOn(mongoose.mongo.MongoClient.prototype, "close")
      .mockRejectedValueOnce(new Error("synthetic-private-close-details"));

    await expect(openRecoveryTestDatabase(environment()))
      .rejects.toBeInstanceOf(RecoveryStorageError);
  });
});
