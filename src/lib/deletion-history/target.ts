import { DeletionHistoryConfigError } from "./config";

export const DELETION_HISTORY_TEST_DATABASE = "sme-deletion-history-test";

type Environment = Readonly<Record<string, string | undefined>>;

export type DeletionHistoryTarget = {
  uri: string;
  databaseName: string;
};

function invalid(): never {
  throw new DeletionHistoryConfigError();
}

// Parse only. Never resolves DNS, opens sockets, or logs supplied values.
export function getDeletionHistoryTarget(
  env: Environment = process.env,
): DeletionHistoryTarget {
  const uri = env.DELETION_HISTORY_MONGODB_URI;
  if (!uri || uri !== uri.trim()) return invalid();

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return invalid();
  }

  if (parsed.hash || parsed.pathname.includes("%")) return invalid();
  const databaseName = parsed.pathname.slice(1);
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(databaseName)) return invalid();

  if (env.NODE_ENV === "test") {
    if (
      parsed.protocol !== "mongodb:" ||
      !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !parsed.port ||
      parsed.username ||
      parsed.password ||
      databaseName !== DELETION_HISTORY_TEST_DATABASE
    ) {
      return invalid();
    }

    const allowed = new Set(["replicaSet", "directConnection"]);
    for (const [name, value] of parsed.searchParams) {
      if (!allowed.has(name) || parsed.searchParams.getAll(name).length !== 1) {
        return invalid();
      }
      if (name === "replicaSet" && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
        return invalid();
      }
      if (name === "directConnection" && !["true", "false"].includes(value)) {
        return invalid();
      }
    }
  } else {
    if (
      parsed.protocol !== "mongodb+srv:" ||
      !/^[a-z0-9-]+\.[a-z0-9.-]+\.mongodb\.net$/i.test(parsed.hostname) ||
      parsed.port ||
      !parsed.username ||
      !parsed.password ||
      databaseName !== "sme-deletion-history"
    ) {
      return invalid();
    }

    // Explicit allowlist prevents URI options from weakening transport controls
    // or overriding database selection. Client safety options follow separately.
    for (const [name, value] of parsed.searchParams) {
      if (parsed.searchParams.getAll(name).length !== 1) return invalid();
      if (name === "authSource" && value === "admin") continue;
      if (name === "appName" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) continue;
      return invalid();
    }
  }

  return { uri, databaseName };
}
