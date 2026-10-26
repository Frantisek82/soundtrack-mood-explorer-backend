import mongoose from "mongoose";

import { getDeletionIdentityConfig } from "./config";

export class DeletionCandidateError extends Error {
  constructor() {
    super("Deletion candidate enumeration failed");
    this.name = "DeletionCandidateError";
  }
}

// Internal, read-only preflight. IDs are returned only for in-process matching;
// never print them. Connection-name checks do not attest operational isolation.
export async function enumerateDeletionCandidates(input: {
  expectedDatabaseName: string;
  expectedNamespace: string;
}): Promise<string[]> {
  try {
    const config = getDeletionIdentityConfig();
    const database = mongoose.connection.db;
    if (
      mongoose.connection.readyState !== 1 ||
      !database ||
      !input.expectedDatabaseName ||
      database.databaseName !== input.expectedDatabaseName ||
      config.namespace !== input.expectedNamespace
    ) throw new DeletionCandidateError();

    const candidates = new Set<string>();
    for (const [collection, field] of [
      ["users", "_id"],
      ["favorites", "userId"],
      ["playlists", "userId"],
      ["spotifyconnections", "userId"],
      ["spotifyoauthtransactions", "userId"],
    ] as const) {
      const cursor = database.collection(collection).find(
        {},
        { projection: { [field]: 1 }, maxTimeMS: 5000 },
      );
      try {
        for await (const record of cursor) {
          const value: unknown = record[field];
          if (!(value instanceof mongoose.mongo.ObjectId)) {
            throw new DeletionCandidateError();
          }
          candidates.add(value.toHexString());
        }
      } finally {
        await cursor.close();
      }
    }
    return [...candidates].sort();
  } catch {
    throw new DeletionCandidateError();
  }
}
