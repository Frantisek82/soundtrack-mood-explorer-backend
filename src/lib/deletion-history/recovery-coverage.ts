import type { DeletionIdentityConfig } from "./config";

export class RecoveryCoverageError extends Error {
  constructor() {
    super("Deletion-history coverage is incomplete or unverifiable");
    this.name = "RecoveryCoverageError";
  }
}

export type SyntheticRecoveryCoverage = {
  schemaVersion: 1;
  namespace: string;
  copyCapturedAt: Date;
  coverageStartedAt: Date;
  historyVerifiedThrough: Date;
  deletionBarrierAt: Date;
  expectedHistoryEpoch: string;
  observedHistoryEpoch: string;
  requiredKeyVersions: string[];
  unresolvedInterruptions: string[];
};

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function invalid(): never {
  throw new RecoveryCoverageError();
}

// Synthetic drill preflight only. Supplied claims are not proof of operational
// completeness, writer isolation, session invalidation, or permission to cut over.
export function validateSyntheticRecoveryCoverage(
  evidence: SyntheticRecoveryCoverage,
  config: DeletionIdentityConfig,
): void {
  if (
    process.env.NODE_ENV !== "test" ||
    !evidence ||
    evidence.schemaVersion !== 1 ||
    evidence.namespace !== config.namespace ||
    !validDate(evidence.copyCapturedAt) ||
    !validDate(evidence.coverageStartedAt) ||
    !validDate(evidence.historyVerifiedThrough) ||
    !validDate(evidence.deletionBarrierAt) ||
    evidence.coverageStartedAt > evidence.copyCapturedAt ||
    evidence.copyCapturedAt > evidence.deletionBarrierAt ||
    evidence.historyVerifiedThrough < evidence.deletionBarrierAt ||
    typeof evidence.expectedHistoryEpoch !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(evidence.expectedHistoryEpoch) ||
    evidence.expectedHistoryEpoch !== evidence.observedHistoryEpoch ||
    !Array.isArray(evidence.unresolvedInterruptions) ||
    evidence.unresolvedInterruptions.length !== 0 ||
    !Array.isArray(evidence.requiredKeyVersions) ||
    evidence.requiredKeyVersions.length === 0 ||
    new Set(evidence.requiredKeyVersions).size !==
      evidence.requiredKeyVersions.length ||
    !evidence.requiredKeyVersions.includes(config.activeKeyVersion)
  ) return invalid();

  for (const version of evidence.requiredKeyVersions) {
    if (
      typeof version !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(version)
    ) return invalid();

    const key = config.keys.get(version);
    if (!Buffer.isBuffer(key) || key.length !== 32) return invalid();
  }
}
