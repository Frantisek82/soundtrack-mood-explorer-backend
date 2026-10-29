import mongoose from "mongoose";

import { openDeletionHistoryDatabase } from "./client";
import { getDeletionIdentityConfig } from "./config";
import { createDeletionIdentifier } from "./identifier";
import { openRecoveryTestDatabase } from "./recovery-client";
import {
  type SyntheticRecoveryCoverage,
  validateSyntheticRecoveryCoverage,
} from "./recovery-coverage";

type Environment = Readonly<Record<string, string | undefined>>;

export class RecoveryReplayError extends Error {
  constructor() {
    super("Recovery replay failed; target remains quarantined");
    this.name = "RecoveryReplayError";
  }
}

function invalid(): never {
  throw new RecoveryReplayError();
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

// Synthetic offline drills only. Caller must stop writers and provider/email
// egress. This function never releases quarantine or marks live intent completed.
export async function replaySyntheticRecovery(
  evidence: SyntheticRecoveryCoverage,
  env: Environment = process.env,
) {
  const config = getDeletionIdentityConfig(env);
  validateSyntheticRecoveryCoverage(evidence, config);

  const recovery = await openRecoveryTestDatabase(env);
  let register: Awaited<ReturnType<typeof openDeletionHistoryDatabase>> | undefined;

  try {
    register = await openDeletionHistoryDatabase(env);

    const obligations = await register.database
      .collection<{ _id: unknown; [field: string]: unknown }>("accountdeletionintents")
      .find({ namespace: config.namespace })
      .toArray();

    const matches = new Set<string>();
    for (const record of obligations) {
      if (
        record.schemaVersion !== 1 ||
        record.namespace !== config.namespace ||
        typeof record.keyVersion !== "string" ||
        !evidence.requiredKeyVersions.includes(record.keyVersion) ||
        !config.keys.has(record.keyVersion) ||
        typeof record.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.digest) ||
        !validDate(record.acceptedAt) ||
        record.acceptedAt > evidence.historyVerifiedThrough ||
        !(
          (record.state === "pending" && record.completedAt === undefined) ||
          (record.state === "completed" &&
            validDate(record.completedAt) &&
            record.completedAt >= record.acceptedAt)
        ) ||
        record._id !== JSON.stringify([
          "sme-account-deletion", 1, config.namespace,
          record.keyVersion, record.digest,
        ])
      ) return invalid();

      matches.add(JSON.stringify([record.keyVersion, record.digest]));
    }

    // Enumerate owners as well as Users: an absent User must not hide saved data.
    // Validate all candidate identifiers before the first recovery mutation.
    const candidates = new Map<string, InstanceType<typeof mongoose.mongo.ObjectId>>();
    for (const [collection, field] of [
      ["users", "_id"],
      ["favorites", "userId"],
      ["playlists", "userId"],
    ] as const) {
      const cursor = recovery.database.collection(collection)
        .find({}, { projection: { [field]: 1 } });
      try {
        for await (const record of cursor) {
          const value: unknown = record[field];
          if (!(value instanceof mongoose.mongo.ObjectId)) return invalid();
          candidates.set(value.toHexString(), value);
        }
      } finally {
        await cursor.close();
      }
    }

    const selected = [];
    for (const [userId, objectId] of candidates) {
      for (const keyVersion of evidence.requiredKeyVersions) {
        const digest = createDeletionIdentifier(userId, {
          namespace: config.namespace,
          keyVersion,
          key: config.keys.get(keyVersion)!,
        });
        if (matches.has(JSON.stringify([keyVersion, digest]))) {
          selected.push(objectId);
          break;
        }
      }
    }

    const database = recovery.database;
    const transactionOptions = {
      readPreference: "primary" as const,
      readConcern: { level: "snapshot" as const },
      writeConcern: { w: "majority" as const, journal: true },
      maxCommitTimeMS: 5000,
    };

    for (const userId of selected) {
      const session = database.client.startSession();
      try {
        await session.withTransaction(async () => {
          await database.collection("favorites").deleteMany({ userId }, { session });
          await database.collection("playlists").deleteMany({ userId }, { session });
          await database.collection("users").deleteOne({ _id: userId }, { session });
        }, transactionOptions);
      } finally {
        await session.endSession();
      }
    }

    // Every restored Spotify authorization is discarded, even for retained Users.
    const session = database.client.startSession();
    try {
      await session.withTransaction(async () => {
        await database.collection("spotifyconnections").deleteMany({}, { session });
        await database.collection("spotifyoauthtransactions").deleteMany({}, { session });
      }, transactionOptions);
    } finally {
      await session.endSession();
    }

    if (
      await database.collection("spotifyconnections").countDocuments() !== 0 ||
      await database.collection("spotifyoauthtransactions").countDocuments() !== 0
    ) return invalid();

    return {
      quarantined: true as const,
      processedAccounts: selected.length,
      spotifySanitized: true as const,
    };
  } catch {
    // Earlier account transactions may have committed. Repeating replay is safe;
    // any failure leaves the entire recovery dataset quarantined.
    throw new RecoveryReplayError();
  } finally {
    try {
      if (register) await register.close();
    } finally {
      await recovery.close();
    }
  }
}
