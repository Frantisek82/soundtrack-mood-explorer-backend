import mongoose from "mongoose";

import { getRecoveryTestTarget } from "./recovery-target";

type Environment = Readonly<Record<string, string | undefined>>;

export class RecoveryStorageError extends Error {
  constructor() {
    super("Quarantined recovery storage unavailable");
    this.name = "RecoveryStorageError";
  }
}

// Synthetic drills only. Owns its client; never uses default Mongoose models.
// Opening a handle does not establish coverage or authorize release from quarantine.
export async function openRecoveryTestDatabase(
  env: Environment = process.env,
) {
  const target = getRecoveryTestTarget(env);
  let client: InstanceType<typeof mongoose.mongo.MongoClient> | undefined;

  try {
    client = new mongoose.mongo.MongoClient(target.uri, {
      appName: "sme-synthetic-recovery",
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
          throw new RecoveryStorageError();
        }
      },
    };
  } catch {
    if (client) {
      try {
        await client.close();
      } catch {
        // Preserve the sanitized connection failure.
      }
    }
    throw new RecoveryStorageError();
  }
}
