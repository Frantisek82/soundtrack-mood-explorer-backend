import { getReconciliationOperatorConfig } from "./reconcile-config";

// Standalone process only. Never reuse an application's existing connection.
export async function executeReconciliationOperator(confirmation: string) {
  try {
    const config = getReconciliationOperatorConfig(confirmation);
    const mongoose = (await import("mongoose")).default;
    if (mongoose.connection.readyState !== 0) {
      throw new Error("Existing application connection");
    }

    // Set before importing models: preflight must not create collections/indexes.
    mongoose.set("autoCreate", false);
    mongoose.set("autoIndex", false);
    mongoose.set("bufferCommands", false);
    try {
      await mongoose.connect(config.applicationUri, {
        appName: "sme-deletion-reconciliation",
        replicaSet: config.input.applicationTopology.setName,
        autoCreate: false,
        autoIndex: false,
        bufferCommands: false,
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
      const { runVerifiedDeletionReconciliation } = await import(
        "./reconcile-verified-run"
      );
      return await runVerifiedDeletionReconciliation(config.input);
    } finally {
      await mongoose.disconnect();
    }
  } catch {
    // Never include driver errors, URIs, identities, or configuration values.
    throw new Error(
      "Deletion reconciliation incomplete; earlier commits may remain. Review and retry.",
    );
  }
}
