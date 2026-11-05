type Environment = Readonly<Record<string, string | undefined>>;

export type DeletionIdentityConfig = {
  namespace: string;
  activeKeyVersion: string;
  keys: ReadonlyMap<string, Buffer>;
};

export class DeletionHistoryConfigError extends Error {
  constructor() {
    super("Invalid deletion-history configuration");
    this.name = "DeletionHistoryConfigError";
  }
}

function invalid(): never {
  throw new DeletionHistoryConfigError();
}

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value || value !== value.trim()) return invalid();
  return value;
}

// Backend only. Lazy validation; never logs configuration or connects to MongoDB.
export function getDeletionIdentityConfig(
  env: Environment = process.env,
): DeletionIdentityConfig {
  const namespace = required(env, "DELETION_HISTORY_NAMESPACE");
  const activeKeyVersion = required(env, "DELETION_HISTORY_ACTIVE_KEY_VERSION");
  const label = /^[A-Za-z0-9_-]{1,64}$/;

  if (!label.test(namespace) || !label.test(activeKeyVersion)) return invalid();

  let parsed: unknown;
  try {
    parsed = JSON.parse(required(env, "DELETION_HISTORY_HMAC_KEYS"));
  } catch {
    return invalid();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid();
  }

  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!label.test(version) || typeof encoded !== "string") return invalid();

    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) return invalid();
    keys.set(version, key);
  }

  if (!keys.has(activeKeyVersion)) return invalid();

  return { namespace, activeKeyVersion, keys };
}
