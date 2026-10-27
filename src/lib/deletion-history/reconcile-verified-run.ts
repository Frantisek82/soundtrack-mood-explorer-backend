import mongoose from "mongoose";

import { enumerateDeletionCandidates } from "./candidates";
import { openDeletionHistoryDatabase } from "./client";
import { getDeletionIdentityConfig } from "./config";
import { reconcileDeletionCandidateUsingRegister } from "./reconcile";
import { verifyReconciliationConnections } from "./reconcile-preflight";
import { DeletionReconciliationRunError } from "./reconcile-run";
import type { ExpectedReconciliationTopology } from "./reconcile-topology";

export type VerifiedReconciliationInput = {
  confirmation: string;
  expectedDatabaseName: string;
  expectedRegisterDatabaseName: string;
  expectedNamespace: string;
  applicationTopology: ExpectedReconciliationTopology;
  registerTopology: ExpectedReconciliationTopology;
};

// Explicit live-intent reconciliation only; never recovery replay or cutover.
// Caller owns the application connection. This function owns one register handle.
export async function runVerifiedDeletionReconciliation(
  input: VerifiedReconciliationInput,
): Promise<{
  candidateCount: number;
  matchedAccounts: number;
  completedObligations: number;
}> {
  try {
    if (
      input.confirmation !== "reconcile-accepted-account-deletions" ||
      mongoose.connection.readyState !== 1 ||
      !mongoose.connection.db
    ) throw new DeletionReconciliationRunError();

    const config = getDeletionIdentityConfig();
    const application = mongoose.connection.db;
    const applicationClient = mongoose.connection.getClient();
    const register = await openDeletionHistoryDatabase();
    try {
      await verifyReconciliationConnections({
        application: {
          database: application,
          expectedDatabaseName: input.expectedDatabaseName,
          expectedTopology: input.applicationTopology,
        },
        register: {
          database: register.database,
          expectedDatabaseName: input.expectedRegisterDatabaseName,
          expectedTopology: input.registerTopology,
        },
        expectedNamespace: input.expectedNamespace,
      });

      // Also check empty datasets: absent candidates do not excuse missing keys.
      const versions = await register.database
        .collection("accountdeletionintents")
        .distinct("keyVersion", { namespace: config.namespace }, { maxTimeMS: 5000 });
      for (const version of versions) {
        if (typeof version !== "string" || !config.keys.has(version)) {
          throw new DeletionReconciliationRunError();
        }
      }

      const candidates = await enumerateDeletionCandidates({
        expectedDatabaseName: input.expectedDatabaseName,
        expectedNamespace: input.expectedNamespace,
      });

      let matchedAccounts = 0;
      let completedObligations = 0;
      for (const userId of candidates) {
        if (
          mongoose.connection.readyState !== 1 ||
          mongoose.connection.db !== application ||
          mongoose.connection.getClient() !== applicationClient
        ) throw new DeletionReconciliationRunError();

        const result = await reconcileDeletionCandidateUsingRegister(
          userId, register.database,
        );
        if (result.matched) matchedAccounts += 1;
        completedObligations += result.completedObligations;
      }

      // Success covers enumerated candidates, not every unmatched pending digest.
      return { candidateCount: candidates.length, matchedAccounts, completedObligations };
    } finally {
      await register.close();
    }
  } catch {
    // Includes disposal failures. Earlier account commits may remain committed.
    throw new DeletionReconciliationRunError();
  }
}
