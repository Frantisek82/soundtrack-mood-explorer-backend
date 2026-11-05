type Environment = Readonly<Record<string, string | undefined>>;

export const RECOVERY_TEST_DATABASE = "sme-quarantined-recovery-test";

export class RecoveryTargetError extends Error {
  constructor() {
    super("Invalid quarantined recovery target");
    this.name = "RecoveryTargetError";
  }
}

function invalid(): never {
  throw new RecoveryTargetError();
}

function localTarget(value: string | undefined) {
  if (!value || value !== value.trim()) return invalid();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    parsed.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost", "::1"].includes(host) ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !/^\/[A-Za-z0-9_-]{1,63}$/.test(parsed.pathname)
  ) return invalid();

  for (const [name, option] of parsed.searchParams) {
    if (
      name !== "replicaSet" ||
      parsed.searchParams.getAll(name).length !== 1 ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(option)
    ) return invalid();
  }

  return {
    uri: value,
    port: Number(parsed.port),
    databaseName: parsed.pathname.slice(1),
  };
}

// Synthetic drills only. This does not attest live quarantine or authorize cutover.
// Treat all loopback aliases as one host when excluding protected ports.
export function getRecoveryTestTarget(env: Environment = process.env) {
  if (
    process.env.NODE_ENV !== "test" ||
    env.NODE_ENV !== "test" ||
    env.RECOVERY_TEST_OPT_IN !== "isolated-synthetic-recovery"
  ) return invalid();

  const target = localTarget(env.RECOVERY_MONGODB_URI);
  const application = localTarget(env.MONGODB_URI);
  const register = localTarget(env.DELETION_HISTORY_MONGODB_URI);

  if (
    target.databaseName !== RECOVERY_TEST_DATABASE ||
    application.databaseName !== "soundtrack-mood-explorer-test" ||
    register.databaseName !== "sme-deletion-history-test" ||
    target.port === application.port ||
    target.port === register.port
  ) return invalid();

  return { uri: target.uri, databaseName: target.databaseName };
}
