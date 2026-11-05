import { describe, expect, it } from "vitest";

import {
  verifyReconciliationTopology,
  verifySeparateReconciliationTopologies,
} from "@/lib/deletion-history/reconcile-topology";

const hosts = ["first.example.invalid:27017", "second.example.invalid:27017"];
const expected = { setName: "synthetic-rs", hosts };
const observed = {
  ok: 1,
  isWritablePrimary: true,
  setName: expected.setName,
  hosts: [...hosts].reverse(),
  me: hosts[0],
  primary: hosts[0],
};

describe("Reconciliation topology verification", () => {
  it("accepts matching primary identity regardless of member ordering", () => {
    expect(() => verifyReconciliationTopology(observed, expected)).not.toThrow();
  });

  it.each([
    null,
    {},
    { ...observed, ok: 0 },
    { ...observed, isWritablePrimary: false },
    { ...observed, msg: "isdbgrid" },
    { ...observed, setName: "another-rs" },
    { ...observed, me: "unlisted.example.invalid:27017" },
    { ...observed, primary: hosts[1] },
    { ...observed, hosts: [hosts[0]] },
    { ...observed, hosts: [...hosts, hosts[0]] },
  ])("rejects absent, ambiguous, or mismatched observed identity", value => {
    expect(() => verifyReconciliationTopology(value, expected))
      .toThrow("Deletion reconciliation target verification failed");
  });

  it.each([
    { hosts: [] },
    { hosts: ["private-credential@host:27017"] },
    { hosts: ["host:65536"] },
    { hosts: ["host:0"] },
    { hosts: ["HOST:27017"] },
    { hosts: [hosts[0], hosts[0]] },
  ])("rejects invalid expected member addresses without exposing them", value => {
    expect(() => verifyReconciliationTopology(observed, {
      ...expected, hosts: value.hosts,
    })).toThrow("Deletion reconciliation target verification failed");
  });
});

describe("Separate application and register topologies", () => {
  const registerHosts = ["register.example.invalid:27017"];
  const register = {
    expected: { setName: "register-rs", hosts: registerHosts },
    observed: {
      ...observed,
      setName: "register-rs",
      hosts: registerHosts,
      me: registerHosts[0],
      primary: registerHosts[0],
    },
  };
  const application = { observed, expected };

  it("accepts independently matching, disjoint member endpoints", () => {
    expect(() => verifySeparateReconciliationTopologies(application, register))
      .not.toThrow();
  });

  it("rejects reuse of the application deployment as the register", () => {
    expect(() => verifySeparateReconciliationTopologies(application, application))
      .toThrow("Deletion reconciliation target verification failed");
  });

  it("rejects any shared member despite a different replica-set name", () => {
    expect(() => verifySeparateReconciliationTopologies(application, {
      expected: { setName: "another-rs", hosts },
      observed: { ...observed, setName: "another-rs" },
    })).toThrow("Deletion reconciliation target verification failed");
  });

  it("rejects a mismatched register before accepting separation", () => {
    expect(() => verifySeparateReconciliationTopologies(application, {
      ...register,
      observed: { ...register.observed, setName: "unexpected-rs" },
    })).toThrow("Deletion reconciliation target verification failed");
  });
});
