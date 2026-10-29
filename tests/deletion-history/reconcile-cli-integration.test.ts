import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { openDeletionHistoryDatabase } from "@/lib/deletion-history/client";
import { getDeletionIdentityConfig } from "@/lib/deletion-history/config";
import { createDeletionIdentifier } from "@/lib/deletion-history/identifier";
import { createDeletionIntentStore } from "@/lib/deletion-history/store";

async function fixture() {
  const database = mongoose.connection.db!;
  const register = await openDeletionHistoryDatabase();
  try {
    const applicationHello = await database.command({ hello: 1 });
    const registerHello = await register.database.command({ hello: 1 });
    const deleted = new mongoose.mongo.ObjectId();
    const retained = new mongoose.mongo.ObjectId();
    const soundtrack = new mongoose.mongo.ObjectId();

    await database.collection("users").insertMany([
      {
        _id: deleted,
        email: `synthetic-deleted-${deleted.toHexString()}@example.invalid`,
      },
      {
        _id: retained,
        email: `synthetic-retained-${retained.toHexString()}@example.invalid`,
      },
    ]);
    await database.collection("soundtracks").insertOne({ _id: soundtrack });
    await database.collection("favorites").insertMany([
      { userId: deleted, soundtrackId: soundtrack },
      { userId: retained, soundtrackId: soundtrack },
    ]);
    await database.collection("playlists").insertMany([
      { userId: deleted, name: "synthetic-deleted" },
      { userId: retained, name: "synthetic-retained" },
    ]);

    const identity = getDeletionIdentityConfig();
    const reference = {
      namespace: identity.namespace,
      keyVersion: identity.activeKeyVersion,
      digest: createDeletionIdentifier(deleted.toHexString(), {
        namespace: identity.namespace,
        keyVersion: identity.activeKeyVersion,
        key: identity.keys.get(identity.activeKeyVersion)!,
      }),
    };
    await createDeletionIntentStore(register.database).recordPending(reference);

    return {
      database, deleted, retained, soundtrack, reference,
      targets: {
        expectedDatabaseName: database.databaseName,
        expectedRegisterDatabaseName: register.database.databaseName,
        expectedNamespace: identity.namespace,
        applicationTopology: {
          setName: applicationHello.setName, hosts: applicationHello.hosts,
        },
        registerTopology: {
          setName: registerHello.setName, hosts: registerHello.hosts,
        },
      },
    };
  } finally {
    await register.close();
  }
}

function run(targets: unknown) {
  const root = process.cwd();
  return spawnSync(resolve(root, "node_modules/.bin/tsx"), [
    "--tsconfig", resolve(root, "tsconfig.json"),
    resolve(root, "scripts/reconcile-deletions.mts"),
    "--confirm", "reconcile-accepted-account-deletions",
  ], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      MONGODB_URI: process.env.MONGODB_URI,
      DELETION_HISTORY_MONGODB_URI: process.env.DELETION_HISTORY_MONGODB_URI,
      DELETION_HISTORY_NAMESPACE: process.env.DELETION_HISTORY_NAMESPACE,
      DELETION_HISTORY_ACTIVE_KEY_VERSION: process.env.DELETION_HISTORY_ACTIVE_KEY_VERSION,
      DELETION_HISTORY_HMAC_KEYS: process.env.DELETION_HISTORY_HMAC_KEYS,
      DELETION_RECONCILIATION_TARGETS: JSON.stringify(targets),
    },
    encoding: "utf8",
    timeout: 30000,
  });
}

describe("Complete CLI against isolated synthetic databases", () => {
  it("rejects a wrong observed target without cleaning accepted deletions", async () => {
    const value = await fixture();
    value.targets.registerTopology.setName = "wrong-synthetic-register";
    const result = run(value.targets);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Deletion reconciliation incomplete");
    expect(await value.database.collection("users").countDocuments()).toBe(2);
    expect(await value.database.collection("favorites").countDocuments()).toBe(2);
    expect(await value.database.collection("playlists").countDocuments()).toBe(2);

    const register = await openDeletionHistoryDatabase();
    try {
      expect((await createDeletionIntentStore(register.database)
        .findExisting(value.reference))?.state).toBe("pending");
    } finally {
      await register.close();
    }
  });

  it("enforces an obligation, preserves unaffected data, and safely repeats", async () => {
    const value = await fixture();
    const first = run(value.targets);
    expect(first.error).toBeUndefined();
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual({
      candidateCount: 2, matchedAccounts: 1, completedObligations: 1,
    });

    expect(await value.database.collection("users")
      .countDocuments({ _id: value.deleted })).toBe(0);
    for (const name of ["favorites", "playlists"]) {
      expect(await value.database.collection(name)
        .countDocuments({ userId: value.deleted })).toBe(0);
      expect(await value.database.collection(name)
        .countDocuments({ userId: value.retained })).toBe(1);
    }
    expect(await value.database.collection("users")
      .countDocuments({ _id: value.retained })).toBe(1);
    expect(await value.database.collection("soundtracks")
      .countDocuments({ _id: value.soundtrack })).toBe(1);

    const register = await openDeletionHistoryDatabase();
    try {
      expect((await createDeletionIntentStore(register.database)
        .findExisting(value.reference))?.state).toBe("completed");
    } finally {
      await register.close();
    }

    const repeated = run(value.targets);
    expect(repeated.error).toBeUndefined();
    expect(repeated.stderr).toBe("");
    expect(repeated.status).toBe(0);
    expect(JSON.parse(repeated.stdout)).toEqual({
      candidateCount: 1, matchedAccounts: 0, completedObligations: 0,
    });
  });
});
