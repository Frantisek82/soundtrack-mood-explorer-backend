import mongoose from "mongoose";

import { getDeletionHistoryTarget } from "./target";

type Environment = Readonly<Record<string, string | undefined>>;

export class DeletionHistoryStorageError extends Error {
  constructor() {
    super("Deletion-history storage unavailable");
    this.name = "DeletionHistoryStorageError";
  }
}

// Each successful call owns its client. The caller must close it in finally.
// No default Mongoose connection, models, global cache, or application cleanup.
export async function openDeletionHistoryDatabase(
  env: Environment = process.env,
) {
  const target = getDeletionHistoryTarget({
    ...env,
    // Callers cannot bypass test guards by supplying another runtime mode.
    NODE_ENV: process.env.NODE_ENV,
  });

  let client: InstanceType<typeof mongoose.mongo.MongoClient> | undefined;
  try {
    client = new mongoose.mongo.MongoClient(target.uri, {
      appName: "sme-deletion-history",
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 5000,
      waitQueueTimeoutMS: 5000,
      timeoutMS: 5000,
      maxPoolSize: 3,
      minPoolSize: 0,
      retryReads: false,
      retryWrites: false,
      readPreference: "primary",
      readConcern: { level: "majority" },
      writeConcern: { w: "majority", journal: true, wtimeoutMS: 5000 },
    });

    await client.connect();
    const ownedClient = client;
    let closed = false;

    return {
      database: ownedClient.db(target.databaseName),
      async close(): Promise<void> {
        if (closed) return;
        try {
          await ownedClient.close();
          closed = true;
        } catch {
          throw new DeletionHistoryStorageError();
        }
      },
    };
  } catch {
    if (client) {
      try {
        await client.close();
      } catch {
        // Preserve a sanitized connection failure even if disposal also fails.
      }
    }
    throw new DeletionHistoryStorageError();
  }
}
