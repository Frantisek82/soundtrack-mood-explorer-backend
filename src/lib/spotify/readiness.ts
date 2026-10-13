import mongoose from "mongoose";

import User from "@/models/User";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";

type IndexDescription = {
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  hidden?: boolean;
  partialFilterExpression?: unknown;
  collation?: { locale?: string };
  expireAfterSeconds?: number;
};

function matchesField(index: IndexDescription, field: string): boolean {
  const key = index.key ?? {};
  return (
    Object.keys(key).length === 1 &&
    key[field] === 1 &&
    index.sparse !== true &&
    index.hidden !== true &&
    index.partialFilterExpression === undefined &&
    (index.collation === undefined || index.collation.locale === "simple")
  );
}

// Call after connectDB(), before permitting OAuth persistence.
// This function never logs configuration or database error details.
export async function assertSpotifyPersistenceReady(): Promise<void> {
  try {
    const database = mongoose.connection.db;
    if (mongoose.connection.readyState !== 1 || !database) {
      throw new Error("Unavailable connection");
    }

    const hello = await database.command({ hello: 1 }, { timeoutMS: 5000 });

    const transactionTopology =
      (typeof hello.setName === "string" && hello.setName.length > 0) ||
      hello.msg === "isdbgrid";

    if (
      !transactionTopology ||
      hello.isWritablePrimary !== true ||
      hello.readOnly === true ||
      !Number.isInteger(hello.maxWireVersion) ||
      hello.maxWireVersion < 8 ||
      typeof hello.logicalSessionTimeoutMinutes !== "number" ||
      !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
      hello.logicalSessionTimeoutMinutes <= 0
    ) {
      throw new Error("Unsupported transaction topology");
    }

    // Add declared indexes; never use syncIndexes() to remove existing ones.
    await SpotifyConnection.createIndexes();
    await SpotifyOAuthTransaction.createIndexes();

    const connectionIndexes = await SpotifyConnection.collection.indexes();
    const transactionIndexes =
      await SpotifyOAuthTransaction.collection.indexes();

    for (const field of ["userId", "accountId"]) {
      if (
        !connectionIndexes.some(
          (index) => matchesField(index, field) && index.unique === true,
        )
      ) {
        throw new Error("Missing connection uniqueness index");
      }
    }

    if (
      !transactionIndexes.some(
        (index) => matchesField(index, "stateHash") && index.unique === true,
      )
    ) {
      throw new Error("Missing state uniqueness index");
    }

    if (
      !transactionIndexes.some(
        (index) => matchesField(index, "userId") && index.unique !== true,
      )
    ) {
      throw new Error("Missing transaction cleanup index");
    }

    if (
      !transactionIndexes.some(
        (index) =>
          matchesField(index, "expiresAt") &&
          index.unique !== true &&
          index.expireAfterSeconds === 0,
      )
    ) {
      throw new Error("Missing transaction expiry index");
    }

    await mongoose.connection.transaction(
      async (session) => {
        await User.findOne({ _id: new mongoose.Types.ObjectId() })
          .select("_id")
          .session(session)
          .maxTimeMS(5000)
          .lean();
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 5000,
      },
    );
  } catch {
    throw new Error("Spotify persistence is not ready");
  }
}
