type Environment = Readonly<Record<string, string | undefined>>;

export type SpotifyConfig =
  | { enabled: false; reason: "disabled" | "preview" }
  | {
      enabled: true;
      clientId: string;
      redirectUri: string;
      frontendOrigin: string;
      encryptionKeys: ReadonlyMap<string, Buffer>;
      activeKeyId: string;
    };

const deployments = [
  {
    frontendOrigin: "http://127.0.0.1:3001",
    redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
  },
  {
    frontendOrigin: "https://soundtrack-mood-explorer-frontend.vercel.app",
    redirectUri:
      "https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback",
  },
] as const;

function invalid(name: string): never {
  throw new Error(`Invalid Spotify configuration: ${name}`);
}

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value || value !== value.trim()) {
    return invalid(name);
  }
  return value;
}

// Backend only. Read lazily; do not import into frontend/client code.
export function getSpotifyConfig(
  env: Environment = process.env,
): SpotifyConfig {
  if (env.VERCEL_ENV === "preview") {
    return { enabled: false, reason: "preview" };
  }

  const enabled = env.SPOTIFY_ENABLED;
  if (enabled === undefined || enabled === "false") {
    return { enabled: false, reason: "disabled" };
  }
  if (enabled !== "true") {
    return invalid("SPOTIFY_ENABLED");
  }

  const clientId = required(env, "SPOTIFY_CLIENT_ID");
  if (!/^[a-fA-F0-9]{32}$/.test(clientId)) {
    return invalid("SPOTIFY_CLIENT_ID");
  }

  const frontendOrigin = required(env, "SPOTIFY_FRONTEND_ORIGIN");
  const redirectUri = required(env, "SPOTIFY_REDIRECT_URI");
  const deployment = deployments.find(
    (candidate) =>
      candidate.frontendOrigin === frontendOrigin &&
      candidate.redirectUri === redirectUri,
  );

  if (!deployment) {
    return invalid("SPOTIFY_FRONTEND_ORIGIN / SPOTIFY_REDIRECT_URI");
  }

  if (env.VERCEL_ENV === "production" && deployment !== deployments[1]) {
    return invalid("production deployment URLs");
  }

  const rawKeys = required(env, "SPOTIFY_TOKEN_ENCRYPTION_KEYS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    return invalid("SPOTIFY_TOKEN_ENCRYPTION_KEYS");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid("SPOTIFY_TOKEN_ENCRYPTION_KEYS");
  }

  const encryptionKeys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || typeof encoded !== "string") {
      return invalid("SPOTIFY_TOKEN_ENCRYPTION_KEYS");
    }

    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      return invalid("SPOTIFY_TOKEN_ENCRYPTION_KEYS");
    }
    encryptionKeys.set(keyId, key);
  }

  const activeKeyId = required(env, "SPOTIFY_TOKEN_ACTIVE_KEY_ID");
  if (!encryptionKeys.has(activeKeyId)) {
    return invalid("SPOTIFY_TOKEN_ACTIVE_KEY_ID");
  }

  return {
    enabled: true,
    clientId,
    redirectUri,
    frontendOrigin,
    encryptionKeys,
    activeKeyId,
  };
}
