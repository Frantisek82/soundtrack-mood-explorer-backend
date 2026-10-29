import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmation = "reconcile-accepted-account-deletions";
const config = {
  applicationUri: "mongodb://127.0.0.1:27017/soundtrack-mood-explorer-test",
  input: { applicationTopology: { setName: "synthetic-rs" } },
};
const result = { candidateCount: 2, matchedAccounts: 1, completedObligations: 1 };

function boundaries() {
  return {
    configure: vi.fn().mockReturnValue(config),
    connection: { readyState: 0 },
    set: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(result),
  };
}
let boundary = boundaries();

async function execute() {
  const { executeReconciliationOperator } = await import(
    "@/lib/deletion-history/reconcile-operator"
  );
  return executeReconciliationOperator(confirmation);
}

describe("Standalone reconciliation operator lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    boundary = boundaries();
    vi.doMock("@/lib/deletion-history/reconcile-config", () => ({
      getReconciliationOperatorConfig: boundary.configure,
    }));
    vi.doMock("mongoose", () => ({
      default: {
        connection: boundary.connection,
        set: boundary.set,
        connect: boundary.connect,
        disconnect: boundary.disconnect,
      },
    }));
    vi.doMock("@/lib/deletion-history/reconcile-verified-run", () => ({
      runVerifiedDeletionReconciliation: boundary.run,
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/deletion-history/reconcile-config");
    vi.doUnmock("mongoose");
    vi.doUnmock("@/lib/deletion-history/reconcile-verified-run");
    vi.resetModules();
  });

  it("uses bounded settings and closes after successful processing", async () => {
    boundary.connect.mockImplementationOnce(async () => {
      expect(boundary.set.mock.calls).toEqual([
        ["autoCreate", false], ["autoIndex", false], ["bufferCommands", false],
      ]);
      expect(boundary.run).not.toHaveBeenCalled();
    });
    expect(await execute()).toEqual(result);
    expect(boundary.connect).toHaveBeenCalledWith(config.applicationUri,
      expect.objectContaining({
        replicaSet: "synthetic-rs",
        autoCreate: false, autoIndex: false, bufferCommands: false,
        timeoutMS: 5000, serverSelectionTimeoutMS: 5000,
        retryReads: false, retryWrites: false,
      }));
    expect(boundary.run).toHaveBeenCalledWith(config.input);
    expect(boundary.disconnect).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid configuration before connecting", async () => {
    boundary.configure.mockImplementationOnce(() => {
      throw new Error("synthetic-private-config");
    });
    await expect(execute()).rejects.toThrow(
      "Deletion reconciliation incomplete; earlier commits may remain. Review and retry.",
    );
    expect(boundary.connect).not.toHaveBeenCalled();
    expect(boundary.disconnect).not.toHaveBeenCalled();
  });

  it("refuses to take ownership of an existing application connection", async () => {
    boundary.connection.readyState = 1;
    await expect(execute()).rejects.toThrow("Deletion reconciliation incomplete");
    expect(boundary.connect).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(boundary.disconnect).not.toHaveBeenCalled();
  });

  it("disposes a failed connection attempt without running cleanup", async () => {
    boundary.connect.mockRejectedValueOnce(new Error("synthetic-private-connect"));
    await expect(execute()).rejects.toThrow("Deletion reconciliation incomplete");
    expect(boundary.run).not.toHaveBeenCalled();
    expect(boundary.disconnect).toHaveBeenCalledTimes(1);
  });

  it("closes after a failed verified run", async () => {
    boundary.run.mockRejectedValueOnce(new Error("synthetic-private-run"));
    await expect(execute()).rejects.toThrow("Deletion reconciliation incomplete");
    expect(boundary.disconnect).toHaveBeenCalledTimes(1);
  });

  it("reports disposal failure without returning success", async () => {
    boundary.disconnect.mockRejectedValueOnce(new Error("synthetic-private-close"));
    await expect(execute()).rejects.toThrow(
      "Deletion reconciliation incomplete; earlier commits may remain. Review and retry.",
    );
  });
});
