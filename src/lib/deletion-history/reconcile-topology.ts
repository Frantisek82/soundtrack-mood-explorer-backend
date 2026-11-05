export class ReconciliationTopologyError extends Error {
  constructor() {
    super("Deletion reconciliation target verification failed");
    this.name = "ReconciliationTopologyError";
  }
}

export type ExpectedReconciliationTopology = {
  setName: string;
  hosts: readonly string[];
};

function invalid(): never {
  throw new ReconciliationTopologyError();
}

function canonicalHosts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return invalid();
  const hosts: string[] = [];
  for (const host of value) {
    if (
      typeof host !== "string" ||
      host !== host.toLowerCase() ||
      !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\]):[1-9][0-9]{0,4}$/.test(host)
    ) return invalid();
    const port = Number(host.slice(host.lastIndexOf(":") + 1));
    if (port > 65535) return invalid();
    hosts.push(host);
  }
  if (new Set(hosts).size !== hosts.length) return invalid();
  return hosts.sort();
}

// Compare an actual hello response with separately supplied expectations.
// This does not establish physical isolation, permissions, or history coverage.
export function verifyReconciliationTopology(
  observed: unknown,
  expected: ExpectedReconciliationTopology,
): void {
  if (
    !expected ||
    typeof expected.setName !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(expected.setName) ||
    !observed ||
    typeof observed !== "object"
  ) return invalid();

  const hello = observed as Record<string, unknown>;
  const hosts = canonicalHosts(hello.hosts);
  const wanted = canonicalHosts(expected.hosts);
  if (
    hello.ok !== 1 ||
    hello.isWritablePrimary !== true ||
    hello.msg === "isdbgrid" ||
    hello.setName !== expected.setName ||
    typeof hello.me !== "string" ||
    !hosts.includes(hello.me) ||
    hello.primary !== hello.me ||
    JSON.stringify(hosts) !== JSON.stringify(wanted)
  ) return invalid();
}

// Require separate replica-set member endpoints for application and register.
// Distinct addresses alone do not prove independent restore/failure boundaries.
export function verifySeparateReconciliationTopologies(
  application: { observed: unknown; expected: ExpectedReconciliationTopology },
  register: { observed: unknown; expected: ExpectedReconciliationTopology },
): void {
  verifyReconciliationTopology(application.observed, application.expected);
  verifyReconciliationTopology(register.observed, register.expected);
  const applicationHosts = new Set(canonicalHosts(application.expected.hosts));
  if (canonicalHosts(register.expected.hosts).some(host => applicationHosts.has(host))) {
    return invalid();
  }
}
