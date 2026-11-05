import { describe, expect, it } from "vitest";

import { getDeletionIdentityConfig } from "@/lib/deletion-history/config";
import {
  RecoveryCoverageError,
  type SyntheticRecoveryCoverage,
  validateSyntheticRecoveryCoverage,
} from "@/lib/deletion-history/recovery-coverage";

function evidence(): SyntheticRecoveryCoverage {
  return {
    schemaVersion: 1,
    namespace: "synthetic-test",
    coverageStartedAt: new Date("2026-10-01T00:00:00Z"),
    copyCapturedAt: new Date("2026-10-02T00:00:00Z"),
    deletionBarrierAt: new Date("2026-10-03T00:00:00Z"),
    historyVerifiedThrough: new Date("2026-10-03T00:00:00Z"),
    expectedHistoryEpoch: "synthetic-history-1",
    observedHistoryEpoch: "synthetic-history-1",
    requiredKeyVersions: ["test-v1"],
    unresolvedInterruptions: [],
  };
}

describe("Synthetic recovery coverage preflight", () => {
  it("accepts internally consistent synthetic evidence", () => {
    expect(() => validateSyntheticRecoveryCoverage(
      evidence(), getDeletionIdentityConfig(),
    )).not.toThrow();
  });

  it.each([
    { namespace: "another-dataset" },
    { coverageStartedAt: new Date("2026-10-02T00:00:01Z") },
    { copyCapturedAt: new Date("2026-10-04T00:00:00Z") },
    { historyVerifiedThrough: new Date("2026-10-02T23:59:59Z") },
    { coverageStartedAt: new Date(NaN) },
    { copyCapturedAt: new Date(NaN) },
    { deletionBarrierAt: new Date(NaN) },
    { historyVerifiedThrough: new Date(NaN) },
    { expectedHistoryEpoch: "" },
    { observedHistoryEpoch: "restored-history-with-unknown-loss" },
    { requiredKeyVersions: [] },
    { requiredKeyVersions: ["test-v1", "missing-old-key"] },
    { requiredKeyVersions: ["test-v1", "test-v1"] },
    { unresolvedInterruptions: ["unreconciled-outage"] },
  ])("rejects incomplete or inconsistent evidence", change => {
    expect(() => validateSyntheticRecoveryCoverage(
      { ...evidence(), ...change },
      getDeletionIdentityConfig(),
    )).toThrow(RecoveryCoverageError);
  });

  it("requires historical keys even when the active key is available", () => {
    const config = getDeletionIdentityConfig();
    const history = {
      ...evidence(),
      requiredKeyVersions: ["test-v0", "test-v1"],
    };

    expect(() => validateSyntheticRecoveryCoverage(history, config))
      .toThrow(RecoveryCoverageError);

    expect(() => validateSyntheticRecoveryCoverage(history, {
      ...config,
      keys: new Map([
        ...config.keys,
        ["test-v0", Buffer.alloc(32, 8)],
      ]),
    })).not.toThrow();
  });

  it("rejects an invalid historical key without exposing key material", () => {
    const config = getDeletionIdentityConfig();
    expect(() => validateSyntheticRecoveryCoverage({
      ...evidence(),
      requiredKeyVersions: ["test-v0", "test-v1"],
    }, {
      ...config,
      keys: new Map([
        ...config.keys,
        ["test-v0", Buffer.alloc(31, 8)],
      ]),
    })).toThrow("Deletion-history coverage is incomplete or unverifiable");
  });
});
