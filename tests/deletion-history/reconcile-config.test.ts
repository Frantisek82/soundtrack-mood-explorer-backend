import { describe, expect, it } from "vitest";

import {
  getReconciliationOperatorConfig,
} from "@/lib/deletion-history/reconcile-config";

const confirmation = "reconcile-accepted-account-deletions";
function environment() {
  return {
    ...process.env,
    MONGODB_URI: "mongodb://127.0.0.1:27017/soundtrack-mood-explorer-test",
    DELETION_RECONCILIATION_TARGETS: JSON.stringify({
      expectedDatabaseName: "soundtrack-mood-explorer-test",
      expectedRegisterDatabaseName: "sme-deletion-history-test",
      expectedNamespace: "synthetic-test",
      applicationTopology: { setName: "app", hosts: ["127.0.0.1:27017"] },
      registerTopology: { setName: "register", hosts: ["127.0.0.1:27018"] },
    }),
  };
}

describe("Operator reconciliation configuration", () => {
  it("parses explicit synthetic configuration without connecting", () => {
    expect(getReconciliationOperatorConfig(confirmation, environment()).input)
      .toMatchObject({
        confirmation,
        expectedNamespace: "synthetic-test",
        expectedDatabaseName: "soundtrack-mood-explorer-test",
      });
  });

  it("requires explicit confirmation", () => {
    expect(() => getReconciliationOperatorConfig("", environment()))
      .toThrow("Deletion reconciliation target verification failed");
  });

  it.each(["", "null", "[]", "{}", "private-malformed-json"])(
    "rejects incomplete target expectations",
    value => {
      expect(() => getReconciliationOperatorConfig(confirmation, {
        ...environment(), DELETION_RECONCILIATION_TARGETS: value,
      })).toThrow("Deletion reconciliation target verification failed");
    },
  );

  it.each([
    "?tls=false",
    "?proxyHost=remote.example.invalid",
    "?authSource=admin&authSource=admin",
    "#fragment",
  ])("rejects unsafe application URI options", suffix => {
    const env = environment();
    expect(() => getReconciliationOperatorConfig(confirmation, {
      ...env, MONGODB_URI: env.MONGODB_URI + suffix,
    })).toThrow("Deletion reconciliation target verification failed");
  });

  it("rejects a database mismatch", () => {
    expect(() => getReconciliationOperatorConfig(confirmation, {
      ...environment(),
      MONGODB_URI: "mongodb://127.0.0.1:27017/another-database",
    })).toThrow("Deletion reconciliation target verification failed");
  });
});
