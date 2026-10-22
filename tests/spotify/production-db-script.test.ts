import { execFile } from "node:child_process";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const { MongoClient } = mongoose.mongo;
let replicaSet: MongoMemoryReplSet;
let client: InstanceType<typeof MongoClient>;
let uri: string;

function run(overrides: Record<string, string | undefined> = {}, provision = false) {
  return new Promise<{
    status: number | string;
    stdout: string;
    stderr: string;
  }>(resolveResult => {
    execFile(
      process.execPath,
      [resolve(provision
        ? "scripts/provision-spotify-production-db.mjs"
        : "scripts/inspect-spotify-production-db.mjs")],
      {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        env: {
          NODE_ENV: "test",
          VERCEL_ENV: "production",
          SPOTIFY_ENABLED: "false",
          SPOTIFY_PROVISION_EMPTY_COLLECTIONS: provision ? "true" : "false",
          MONGODB_URI: uri,
          ...overrides,
        },
      },
      (error, stdout, stderr) => {
        resolveResult({
          status: error?.code ?? (error ? "execution_failure" : 0),
          stdout,
          stderr,
        });
      },
    );
  });
}

async function createIndexes(ttl = 0) {
  const database = client.db("soundtrack-explorer");
  await database.createCollection("users");
  await database.collection("spotifyconnections").createIndexes([
    { key: { userId: 1 }, unique: true },
    { key: { accountId: 1 }, unique: true },
  ]);
  await database.collection("spotifyoauthtransactions").createIndexes([
    { key: { stateHash: 1 }, unique: true },
    { key: { userId: 1 } },
    { key: { expiresAt: 1 }, expireAfterSeconds: ttl },
  ]);
}

describe("Read-only Production database inspection script", () => {
  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    uri = replicaSet.getUri("soundtrack-explorer");
    client = new MongoClient(uri);
    await client.connect();
  }, 60_000);

  beforeEach(async () => {
    // This client belongs exclusively to the replica set created above.
    await client.db("soundtrack-explorer").dropDatabase();
  });

  afterAll(async () => {
    if (client) await client.close();
    if (replicaSet) await replicaSet.stop();
  });

  it("reports missing indexes without creating collections", async () => {
    const result = await run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Connection userId unique index: FAIL");
    expect(result.stdout).toContain("Transaction expiresAt TTL index: FAIL");
    expect(result.stdout).toContain("Transactional read: PASS");
    expect(result.stderr).toBe("");
    expect(
      await client.db("soundtrack-explorer").listCollections().toArray(),
    ).toEqual([]);
  });

  it("verifies real indexes and a transaction without changing stored data", async () => {
    await createIndexes();
    const database = client.db("soundtrack-explorer");
    await database.collection("users").insertOne({
      _id: new mongoose.mongo.ObjectId(),
      name: "Test-only preserved user",
    });

    const usersBefore = await database.collection("users").find().toArray();
    const connectionsBefore = await database
      .collection("spotifyconnections").listIndexes().toArray();
    const transactionsBefore = await database
      .collection("spotifyoauthtransactions").listIndexes().toArray();

    const result = await run();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("FAIL");
    expect(result.stdout).toContain("Transactional read: PASS");
    expect(await database.collection("users").find().toArray())
      .toEqual(usersBefore);
    expect(await database.collection("spotifyconnections").listIndexes().toArray())
      .toEqual(connectionsBefore);
    expect(await database.collection("spotifyoauthtransactions").listIndexes().toArray())
      .toEqual(transactionsBefore);
  });

  it("reports an incorrect TTL without replacing it", async () => {
    await createIndexes(600);
    const result = await run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Transaction expiresAt TTL index: FAIL");

    const indexes = await client.db("soundtrack-explorer")
      .collection("spotifyoauthtransactions").listIndexes().toArray();
    expect(indexes.find(index => index.key.expiresAt === 1)?.expireAfterSeconds)
      .toBe(600);
  });

  it.each([
    { VERCEL_ENV: "preview" },
    { SPOTIFY_ENABLED: "true" },
  ])("rejects unsafe execution conditions: %j", async overrides => {
    const result = await run(overrides);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Database inspection: FAIL during environment guards; details withheld.\n",
    );
  });

  it("rejects an unintended database before connecting", async () => {
    const result = await run({
      MONGODB_URI: replicaSet.getUri("wrong-target"),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("FAIL during environment guards");
  });

  it("does not expose a malformed connection string", async () => {
    const privateValue = "test-only-private-invalid-uri";
    const result = await run({ MONGODB_URI: privateValue });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("details withheld");
    expect(result.stdout + result.stderr).not.toContain(privateValue);
  });

  it("requires explicit provisioning opt-in", async () => {
    const result = await run({
      SPOTIFY_PROVISION_EMPTY_COLLECTIONS: "false",
    }, true);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(
      await client.db("soundtrack-explorer").listCollections().toArray(),
    ).toEqual([]);
  });

  it("provisions missing collections and verifies all required indexes", async () => {
    const result = await run({}, true);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("FAIL");
    expect(result.stdout).toContain("Transactional read: PASS");

    const database = client.db("soundtrack-explorer");
    expect(await database.collection("spotifyconnections").countDocuments()).toBe(0);
    expect(await database.collection("spotifyoauthtransactions").countDocuments()).toBe(0);

    const verification = await run();
    expect(verification.status).toBe(0);
    expect(verification.stdout).not.toContain("FAIL");
  });

  it.each(["spotifyconnections", "spotifyoauthtransactions"])(
    "refuses provisioning when %s contains records",
    async name => {
      const database = client.db("soundtrack-explorer");
      await database.collection(name).insertOne({ sentinel: "test-only" });
      const before = await database.listCollections().toArray();
      const indexesBefore = await database.collection(name).listIndexes().toArray();

      const result = await run({}, true);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("FAIL during empty-collection preflight");
      expect(await database.listCollections().toArray()).toEqual(before);
      expect(await database.collection(name).listIndexes().toArray()).toEqual(indexesBefore);
      expect(await database.collection(name).countDocuments()).toBe(1);
    },
  );

  it("allows repeated provisioning of empty collections without index changes", async () => {
    await createIndexes();
    const database = client.db("soundtrack-explorer");
    const before = await database.collection("spotifyconnections").listIndexes().toArray();
    const transactionsBefore = await database
      .collection("spotifyoauthtransactions").listIndexes().toArray();

    const result = await run({}, true);

    expect(result.status).toBe(0);
    expect(await database.collection("spotifyconnections").listIndexes().toArray()).toEqual(before);
    expect(await database.collection("spotifyoauthtransactions").listIndexes().toArray())
      .toEqual(transactionsBefore);
  });

});
