import {
  enumerateDeletionCandidates,
} from "./candidates";
import { reconcileDeletionCandidate } from "./reconcile";

export class DeletionReconciliationRunError extends Error {
  constructor() {
    super("Deletion reconciliation run incomplete; review and retry");
    this.name = "DeletionReconciliationRunError";
  }
}

// Explicit operator invocation only. Never attach to startup, HTTP, or a timer.
// Database/namespace expectations are checked before candidate processing.
// They do not independently attest cluster identity or operational authorization.
export async function runDeletionReconciliation(input: {
  expectedDatabaseName: string;
  expectedNamespace: string;
  confirmation: string;
}): Promise<{
  candidateCount: number;
  matchedAccounts: number;
  completedObligations: number;
}> {
  try {
    if (
      input.confirmation !== "reconcile-accepted-account-deletions" ||
      typeof input.expectedDatabaseName !== "string" ||
      !/^[A-Za-z0-9_-]{1,63}$/.test(input.expectedDatabaseName) ||
      typeof input.expectedNamespace !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(input.expectedNamespace)
    ) throw new DeletionReconciliationRunError();

    const candidates = await enumerateDeletionCandidates({
      expectedDatabaseName: input.expectedDatabaseName,
      expectedNamespace: input.expectedNamespace,
    });

    let matchedAccounts = 0;
    let completedObligations = 0;
    for (const userId of candidates) {
      const result = await reconcileDeletionCandidate(userId);
      if (result.matched) matchedAccounts += 1;
      completedObligations += result.completedObligations;
    }

    // Aggregate evidence only. No IDs, digests, credentials, or user records.
    return {
      candidateCount: candidates.length,
      matchedAccounts,
      completedObligations,
    };
  } catch {
    // No rollback of earlier account commits is claimed.
    throw new DeletionReconciliationRunError();
  }
}
