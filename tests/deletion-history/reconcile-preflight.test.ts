import { describe, expect, it, vi } from "vitest";

import {
  verifyReconciliationConnections,
} from "@/lib/deletion-history/reconcile-preflight";

function target(name: string, host: string) {
  const expectedTopology = { setName: name, hosts: [host] };
  const command = vi.fn().mockResolvedValue({
    ok: 1, isWritablePrimary: true,
    setName: name, hosts: [host], me: host, primary: host,
  });
  return {
    database: { databaseName: name, command },
    expectedDatabaseName: name,
    expectedTopology,
  };
}

function input() {
  return {
    application: target("application", "application.example.invalid:27017"),
    register: target("register", "register.example.invalid:27017"),
    expectedNamespace: "synthetic-test",
  };
}

describe("Read-only reconciliation connection preflight", () => {
  it("checks both connected targets with bounded hello commands", async () => {
    const value = input();
    await expect(verifyReconciliationConnections(value)).resolves.toBeUndefined();
    for (const probe of [value.application, value.register]) {
      expect(probe.database.command.mock.calls).toEqual([
        [{ hello: 1 }, { timeoutMS: 5000 }],
      ]);
    }
  });

  it.each(["application", "register"] as const)(
    "rejects a wrong %s database before probing either deployment",
    async name => {
      const value = input();
      value[name].expectedDatabaseName = "wrong-database";
      await expect(verifyReconciliationConnections(value))
        .rejects.toThrow("Deletion reconciliation target verification failed");
      expect(value.application.database.command).not.toHaveBeenCalled();
      expect(value.register.database.command).not.toHaveBeenCalled();
    },
  );

  it("rejects a namespace mismatch before probing", async () => {
    const value = input();
    value.expectedNamespace = "another-dataset";
    await expect(verifyReconciliationConnections(value))
      .rejects.toThrow("Deletion reconciliation target verification failed");
    expect(value.application.database.command).not.toHaveBeenCalled();
    expect(value.register.database.command).not.toHaveBeenCalled();
  });

  it("sanitizes driver failures", async () => {
    const value = input();
    value.application.database.command.mockRejectedValueOnce(
      new Error("synthetic-private-driver-details"),
    );
    await expect(verifyReconciliationConnections(value))
      .rejects.toThrow("Deletion reconciliation target verification failed");
    expect(value.register.database.command).not.toHaveBeenCalled();
  });

  it("rejects mismatched observed register identity", async () => {
    const value = input();
    value.register.database.command.mockResolvedValueOnce({
      ok: 1, isWritablePrimary: true, setName: "unexpected",
      hosts: ["register.example.invalid:27017"],
      me: "register.example.invalid:27017",
      primary: "register.example.invalid:27017",
    });
    await expect(verifyReconciliationConnections(value))
      .rejects.toThrow("Deletion reconciliation target verification failed");
  });
});
