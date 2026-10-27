import { getDeletionIdentityConfig } from "./config";
import { getDeletionHistoryTarget } from "./target";
import {
  type ExpectedReconciliationTopology,
  ReconciliationTopologyError,
} from "./reconcile-topology";
import type { VerifiedReconciliationInput } from "./reconcile-verified-run";

type Environment = Readonly<Record<string, string | undefined>>;

function invalid(): never {
  throw new ReconciliationTopologyError();
}

function topology(value: unknown): ExpectedReconciliationTopology {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).sort().join(",") !== "hosts,setName" ||
    typeof item.setName !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(item.setName) ||
    !Array.isArray(item.hosts) ||
    item.hosts.length === 0
  ) return invalid();

  const hosts: string[] = [];
  for (const host of item.hosts) {
    if (
      typeof host !== "string" ||
      !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\]):[1-9][0-9]{0,4}$/.test(host) ||
      Number(host.slice(host.lastIndexOf(":") + 1)) > 65535
    ) return invalid();
    hosts.push(host);
  }
  if (new Set(hosts).size !== hosts.length) return invalid();
  return { setName: item.setName, hosts };
}

// Parse only. No environment-file loading, DNS, sockets, or configuration output.
export function getReconciliationOperatorConfig(
  confirmation: string,
  env: Environment = process.env,
): { applicationUri: string; input: VerifiedReconciliationInput } {
  try {
    if (confirmation !== "reconcile-accepted-account-deletions") return invalid();
    const identity = getDeletionIdentityConfig(env);
    const register = getDeletionHistoryTarget(env);
    const raw = env.DELETION_RECONCILIATION_TARGETS;
    if (!raw || raw !== raw.trim()) return invalid();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid();
    const targets = parsed as Record<string, unknown>;
    if (
      Object.keys(targets).sort().join(",") !==
        "applicationTopology,expectedDatabaseName,expectedNamespace,expectedRegisterDatabaseName,registerTopology" ||
      typeof targets.expectedDatabaseName !== "string" ||
      !/^[A-Za-z0-9_-]{1,63}$/.test(targets.expectedDatabaseName) ||
      targets.expectedRegisterDatabaseName !== register.databaseName ||
      targets.expectedNamespace !== identity.namespace
    ) return invalid();

    const uri = env.MONGODB_URI;
    if (!uri || uri !== uri.trim()) return invalid();
    const application = new URL(uri);
    if (
      application.hash ||
      application.pathname !== "/" + targets.expectedDatabaseName
    ) return invalid();

    if (env.NODE_ENV === "test") {
      if (
        application.protocol !== "mongodb:" ||
        !["127.0.0.1", "[::1]"].includes(application.hostname) ||
        !application.port ||
        application.username || application.password ||
        targets.expectedDatabaseName !== "soundtrack-mood-explorer-test"
      ) return invalid();
    } else {
      if (
        application.protocol !== "mongodb+srv:" ||
        !/^[a-z0-9-]+\.[a-z0-9.-]+\.mongodb\.net$/i.test(application.hostname) ||
        application.port || !application.username || !application.password
      ) return invalid();
    }

    for (const [name, value] of application.searchParams) {
      if (application.searchParams.getAll(name).length !== 1) return invalid();
      if (name === "replicaSet" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) continue;
      if (name === "authSource" && value === "admin") continue;
      if (name === "appName" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) continue;
      return invalid();
    }

    const applicationTopology = topology(targets.applicationTopology);
    const registerTopology = topology(targets.registerTopology);
    if (applicationTopology.hosts.some(host => registerTopology.hosts.includes(host))) {
      return invalid();
    }
    const uriSetName = application.searchParams.get("replicaSet");
    if (uriSetName && uriSetName !== applicationTopology.setName) return invalid();

    return {
      applicationUri: uri,
      input: {
        confirmation,
        expectedDatabaseName: targets.expectedDatabaseName,
        expectedRegisterDatabaseName: register.databaseName,
        expectedNamespace: identity.namespace,
        applicationTopology,
        registerTopology,
      },
    };
  } catch {
    throw new ReconciliationTopologyError();
  }
}
