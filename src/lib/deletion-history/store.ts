import mongoose from "mongoose";

import { DeletionHistoryStorageError } from "./client";

type Database = ReturnType<
  InstanceType<typeof mongoose.mongo.MongoClient>["db"]
>;

export type DeletionReference = {
  namespace: string;
  keyVersion: string;
  digest: string;
};

export type DeletionIntent = DeletionReference & {
  _id: string;
  schemaVersion: 1;
  acceptedAt: Date;
  state: "pending" | "completed";
  completedAt?: Date;
};

function recordId(reference: DeletionReference): string {
  const label = /^[A-Za-z0-9_-]{1,64}$/;
  if (
    !label.test(reference.namespace) ||
    !label.test(reference.keyVersion) ||
    !/^[a-f0-9]{64}$/.test(reference.digest)
  ) {
    throw new DeletionHistoryStorageError();
  }

  return JSON.stringify([
    "sme-account-deletion",
    1,
    reference.namespace,
    reference.keyVersion,
    reference.digest,
  ]);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validate(
  value: DeletionIntent | null,
  reference: DeletionReference,
  id: string,
): DeletionIntent {
  if (
    !value ||
    value._id !== id ||
    value.schemaVersion !== 1 ||
    value.namespace !== reference.namespace ||
    value.keyVersion !== reference.keyVersion ||
    value.digest !== reference.digest ||
    !validDate(value.acceptedAt) ||
    !(
      (value.state === "pending" && value.completedAt === undefined) ||
      (value.state === "completed" &&
        validDate(value.completedAt) &&
        value.completedAt.getTime() >= value.acceptedAt.getTime())
    )
  ) {
    throw new DeletionHistoryStorageError();
  }
  return value;
}

// Supply only the independently owned, validated register database.
// Never invoke these operations inside an application transaction callback.
export function createDeletionIntentStore(database: Database) {
  const records = database.collection<DeletionIntent>("accountdeletionintents");

  async function read(reference: DeletionReference, id: string) {
    return validate(await records.findOne({ _id: id }), reference, id);
  }

  return {
    async findExisting(
      reference: DeletionReference,
    ): Promise<DeletionIntent | null> {
      const id = recordId(reference);
      try {
        const value = await records.findOne({ _id: id });
        return value === null ? null : validate(value, reference, id);
      } catch {
        throw new DeletionHistoryStorageError();
      }
    },

    async recordPending(reference: DeletionReference): Promise<DeletionIntent> {
      const id = recordId(reference);
      const record: DeletionIntent = {
        _id: id,
        schemaVersion: 1,
        namespace: reference.namespace,
        keyVersion: reference.keyVersion,
        digest: reference.digest,
        acceptedAt: new Date(),
        state: "pending",
      };

      try {
        try {
          const result = await records.insertOne(record);
          if (!result.acknowledged) throw new DeletionHistoryStorageError();
          return record;
        } catch (error) {
          if (
            error instanceof mongoose.mongo.MongoServerError &&
            error.code === 11000
          ) {
            return await read(reference, id);
          }
          throw error;
        }
      } catch {
        // A failed acknowledgement does not establish that nothing was stored.
        throw new DeletionHistoryStorageError();
      }
    },

    async markLiveCleanupCompleted(
      reference: DeletionReference,
    ): Promise<DeletionIntent> {
      const id = recordId(reference);
      try {
        const existing = await read(reference, id);
        if (existing.state === "completed") return existing;

        // Preserve timestamp ordering even if this process's clock moved back.
        const completedAt = new Date(Math.max(
          Date.now(),
          existing.acceptedAt.getTime(),
        ));

        const result = await records.updateOne(
          { _id: id, state: "pending", schemaVersion: 1 },
          { $set: { state: "completed", completedAt } },
          { upsert: false },
        );
        if (!result.acknowledged) throw new DeletionHistoryStorageError();

        const current = await read(reference, id);
        if (current.state !== "completed") {
          throw new DeletionHistoryStorageError();
        }
        return current;
      } catch {
        throw new DeletionHistoryStorageError();
      }
    },
  };
}
