import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import {
  enumerateDeletionCandidates,
} from "@/lib/deletion-history/candidates";

function input() {
  return {
    expectedDatabaseName: "soundtrack-mood-explorer-test",
    expectedNamespace: "synthetic-test",
  };
}

async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const name of [
    "users", "favorites", "playlists",
    "spotifyconnections", "spotifyoauthtransactions",
  ]) {
    result[name] = await mongoose.connection.db!.collection(name)
      .find({}).sort({ _id: 1 }).toArray();
  }
  return result;
}

describe("Read-only deletion candidate enumeration", () => {
  it("collects distinct Users and orphan owners from every owned collection", async () => {
    const database = mongoose.connection.db!;
    const owners = Array.from(
      { length: 5 }, () => new mongoose.mongo.ObjectId(),
    );
    await database.collection("users").insertOne({ _id: owners[0] });
    for (const [index, name] of [
      "favorites", "playlists",
      "spotifyconnections", "spotifyoauthtransactions",
    ].entries()) {
      await database.collection(name).insertMany(
        [owners[0], owners[index + 1]].map((userId, position) => ({
          userId,
          ...(name === "spotifyconnections"
            ? { accountId: `synthetic-enumeration-${position}` }
            : {}),
          ...(name === "spotifyoauthtransactions"
            ? { stateHash: String(position + 1).repeat(64) }
            : {}),
        })),
      );
    }
    const before = await snapshot();

    expect(await enumerateDeletionCandidates(input())).toEqual(
      owners.map(owner => owner.toHexString()).sort(),
    );
    expect(await snapshot()).toEqual(before);
  });

  it("returns no candidates for an empty dataset", async () => {
    expect(await enumerateDeletionCandidates(input())).toEqual([]);
  });

  it.each([
    { expectedDatabaseName: "another-dataset" },
    { expectedDatabaseName: "" },
    { expectedNamespace: "another-namespace" },
  ])("rejects a dataset expectation mismatch", async change => {
    await expect(enumerateDeletionCandidates({ ...input(), ...change }))
      .rejects.toThrow("Deletion candidate enumeration failed");
  });

  it.each([
    ["users", "_id"],
    ["favorites", "userId"],
    ["playlists", "userId"],
    ["spotifyconnections", "userId"],
    ["spotifyoauthtransactions", "userId"],
  ])("rejects malformed identifiers in %s without changing records", async (name, field) => {
    await mongoose.connection.db!
      .collection<{ _id?: unknown; [key: string]: unknown }>(name)
      .insertOne({ [field]: "synthetic-malformed-identifier" });
    const before = await snapshot();

    await expect(enumerateDeletionCandidates(input()))
      .rejects.toThrow("Deletion candidate enumeration failed");
    expect(await snapshot()).toEqual(before);
  });
});
