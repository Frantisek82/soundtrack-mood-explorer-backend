import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  open: vi.fn(), verify: vi.fn(), enumerate: vi.fn(),
  reconcile: vi.fn(), distinct: vi.fn(), close: vi.fn(),
}));
vi.mock("@/lib/deletion-history/client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/deletion-history/client")>(),
  openDeletionHistoryDatabase: boundary.open,
}));
vi.mock("@/lib/deletion-history/reconcile-preflight", () => ({
  verifyReconciliationConnections: boundary.verify,
}));
vi.mock("@/lib/deletion-history/candidates", () => ({
  enumerateDeletionCandidates: boundary.enumerate,
}));
vi.mock("@/lib/deletion-history/reconcile", () => ({
  reconcileDeletionCandidateUsingRegister: boundary.reconcile,
  reconcileDeletionCandidate: vi.fn(),
}));

import {
  runVerifiedDeletionReconciliation,
} from "@/lib/deletion-history/reconcile-verified-run";

const database = {
  collection: vi.fn(() => ({ distinct: boundary.distinct })),
};
const ids = ["a".repeat(24), "b".repeat(24)];
function input() {
  return {
    confirmation: "reconcile-accepted-account-deletions",
    expectedDatabaseName: "soundtrack-mood-explorer-test",
    expectedRegisterDatabaseName: "sme-deletion-history-test",
    expectedNamespace: "synthetic-test",
    applicationTopology: { setName: "app", hosts: ["app.example.invalid:27017"] },
    registerTopology: { setName: "register", hosts: ["register.example.invalid:27017"] },
  };
}

describe("Verified reconciliation runner boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.open.mockResolvedValue({ database, close: boundary.close });
    boundary.verify.mockResolvedValue(undefined);
    boundary.distinct.mockResolvedValue(["test-v1"]);
    boundary.enumerate.mockResolvedValue(ids);
    boundary.reconcile.mockResolvedValue({ matched: true, completedObligations: 1 });
    boundary.close.mockResolvedValue(undefined);
  });

  it("verifies before enumeration and reuses one register handle", async () => {
    boundary.verify.mockImplementationOnce(async () => {
      expect(boundary.enumerate).not.toHaveBeenCalled();
      expect(boundary.reconcile).not.toHaveBeenCalled();
    });
    expect(await runVerifiedDeletionReconciliation(input())).toEqual({
      candidateCount: 2, matchedAccounts: 2, completedObligations: 2,
    });
    expect(boundary.open).toHaveBeenCalledTimes(1);
    expect(boundary.reconcile.mock.calls).toEqual([
      [ids[0], database], [ids[1], database],
    ]);
    expect(boundary.close).toHaveBeenCalledTimes(1);
  });

  it("rejects missing confirmation before opening the register", async () => {
    await expect(runVerifiedDeletionReconciliation({ ...input(), confirmation: "" }))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    expect(boundary.open).not.toHaveBeenCalled();
  });

  it("closes without enumeration or cleanup after failed verification", async () => {
    boundary.verify.mockRejectedValueOnce(new Error("synthetic-private-detail"));
    await expect(runVerifiedDeletionReconciliation(input()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    expect(boundary.enumerate).not.toHaveBeenCalled();
    expect(boundary.reconcile).not.toHaveBeenCalled();
    expect(boundary.close).toHaveBeenCalledTimes(1);
  });

  it("rejects missing historical keys before enumeration", async () => {
    boundary.distinct.mockResolvedValueOnce(["unavailable-old-key"]);
    await expect(runVerifiedDeletionReconciliation(input()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    expect(boundary.enumerate).not.toHaveBeenCalled();
    expect(boundary.reconcile).not.toHaveBeenCalled();
    expect(boundary.close).toHaveBeenCalledTimes(1);
  });

  it("checks connections and historical keys for an empty dataset", async () => {
    boundary.enumerate.mockResolvedValueOnce([]);
    expect(await runVerifiedDeletionReconciliation(input())).toEqual({
      candidateCount: 0, matchedAccounts: 0, completedObligations: 0,
    });
    expect(boundary.verify).toHaveBeenCalledTimes(1);
    expect(boundary.distinct).toHaveBeenCalledTimes(1);
    expect(boundary.reconcile).not.toHaveBeenCalled();
  });

  it("stops on a failed candidate and closes the handle", async () => {
    boundary.reconcile.mockRejectedValueOnce(new Error("synthetic-private-detail"));
    await expect(runVerifiedDeletionReconciliation(input()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    expect(boundary.reconcile).toHaveBeenCalledTimes(1);
    expect(boundary.close).toHaveBeenCalledTimes(1);
  });

  it("sanitizes a register disposal failure", async () => {
    boundary.close.mockRejectedValueOnce(new Error("synthetic-private-close-detail"));
    await expect(runVerifiedDeletionReconciliation(input()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
  });
});
