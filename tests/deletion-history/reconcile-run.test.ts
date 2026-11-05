import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  enumerate: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/deletion-history/candidates", () => ({
  enumerateDeletionCandidates: boundary.enumerate,
}));
vi.mock("@/lib/deletion-history/reconcile", () => ({
  reconcileDeletionCandidate: boundary.reconcile,
}));

import {
  runDeletionReconciliation,
} from "@/lib/deletion-history/reconcile-run";

const first = "a".repeat(24);
const second = "b".repeat(24);
const third = "c".repeat(24);

function input() {
  return {
    expectedDatabaseName: "soundtrack-mood-explorer-test",
    expectedNamespace: "synthetic-test",
    confirmation: "reconcile-accepted-account-deletions",
  };
}

describe("Explicit deletion reconciliation runner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    boundary.enumerate.mockResolvedValue([first, second]);
    boundary.reconcile.mockResolvedValue({
      matched: false, completedObligations: 0,
    });
  });

  it.each([
    { confirmation: "" },
    { confirmation: "yes" },
    { expectedDatabaseName: "" },
    { expectedNamespace: "invalid/namespace" },
  ])("rejects invalid invocation before enumeration or cleanup", async change => {
    await expect(runDeletionReconciliation({ ...input(), ...change }))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    expect(boundary.enumerate).not.toHaveBeenCalled();
    expect(boundary.reconcile).not.toHaveBeenCalled();
  });

  it("finishes enumeration before cleanup and returns aggregate evidence only", async () => {
    boundary.enumerate.mockImplementation(async () => {
      expect(boundary.reconcile).not.toHaveBeenCalled();
      return [first, second];
    });
    boundary.reconcile
      .mockResolvedValueOnce({ matched: true, completedObligations: 2 })
      .mockResolvedValueOnce({ matched: false, completedObligations: 0 });

    const result = await runDeletionReconciliation(input());

    expect(boundary.enumerate).toHaveBeenCalledWith({
      expectedDatabaseName: input().expectedDatabaseName,
      expectedNamespace: input().expectedNamespace,
    });
    expect(boundary.reconcile.mock.calls).toEqual([[first], [second]]);
    expect(result).toEqual({
      candidateCount: 2, matchedAccounts: 1, completedObligations: 2,
    });
    expect(JSON.stringify(result)).not.toContain(first);
    expect(JSON.stringify(result)).not.toContain(second);
  });

  it("does not clean anything when enumeration fails", async () => {
    boundary.enumerate.mockRejectedValueOnce(
      new Error("synthetic-private-enumeration-failure"),
    );

    await expect(runDeletionReconciliation(input()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    expect(boundary.reconcile).not.toHaveBeenCalled();
  });

  it("stops at a failed candidate without processing later candidates", async () => {
    boundary.enumerate.mockResolvedValueOnce([first, second, third]);
    boundary.reconcile
      .mockResolvedValueOnce({ matched: true, completedObligations: 1 })
      .mockRejectedValueOnce(new Error("synthetic-private-cleanup-failure"));

    await expect(runDeletionReconciliation(input()))
      .rejects.toThrow("Deletion reconciliation run incomplete; review and retry");
    expect(boundary.reconcile.mock.calls).toEqual([[first], [second]]);
  });

  it("handles an empty dataset without cleanup", async () => {
    boundary.enumerate.mockResolvedValueOnce([]);

    await expect(runDeletionReconciliation(input())).resolves.toEqual({
      candidateCount: 0, matchedAccounts: 0, completedObligations: 0,
    });
    expect(boundary.reconcile).not.toHaveBeenCalled();
  });
});
