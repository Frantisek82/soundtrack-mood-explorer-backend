import type { SpotifyConfig } from "./config";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

export class SpotifyProviderError extends Error {
  constructor(
    public readonly code:
      | "provider_error"
      | "access_restricted"
      | "rate_limited" = "provider_error",
    public readonly retryAfterSeconds?: number,
  ) {
    super("Spotify provider request failed");
    this.name = "SpotifyProviderError";
  }
}

export type SpotifyAuthorization = {
  accountId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
  authorizedAt: Date;
  accessExpiresAt: Date;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SpotifyProviderError();
  }
  return value as Record<string, unknown>;
}

function credential(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 16_384 ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new SpotifyProviderError();
  }
  return value;
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new SpotifyProviderError();

  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;

      length += chunk.value.byteLength;
      if (length > 65_536) {
        await reader.cancel();
        throw new SpotifyProviderError();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
}

async function requestJson(
  url: string,
  options: RequestInit,
  deadline: AbortSignal,
): Promise<Record<string, unknown>> {
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(10_000)]);
  signal.throwIfAborted();

  const response = await fetch(url, {
    ...options,
    signal,
    redirect: "error",
    cache: "no-store",
  });

  if (!response.ok) {
    const retryHeader = response.headers.get("retry-after");
    const retryAfterSeconds =
      retryHeader !== null && /^\d{1,5}$/.test(retryHeader)
        ? Number(retryHeader)
        : undefined;

    await response.body?.cancel().catch(() => undefined);

    throw new SpotifyProviderError(
      response.status === 403
        ? "access_restricted"
        : response.status === 429
          ? "rate_limited"
          : "provider_error",
      response.status === 429 ? retryAfterSeconds : undefined,
    );
  }

  return record(await boundedJson(response));
}

// Backend only: this result contains plaintext credentials until persistence
// encrypts them. Never return or log this object from a route.
// There are no automatic retries, including authorization-code exchange.
export async function authorizeSpotifyAccount(input: {
  code: string;
  verifier: string;
  config: EnabledSpotifyConfig;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<SpotifyAuthorization> {
  try {
    if (
      typeof input.code !== "string" ||
      input.code.length === 0 ||
      input.code.length > 4096 ||
      !/^[\x21-\x7e]+$/.test(input.code) ||
      typeof input.verifier !== "string" ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)
    ) {
      throw new SpotifyProviderError();
    }

    const deadline = AbortSignal.any([
      AbortSignal.timeout(20_000),
      ...(input.signal ? [input.signal] : []),
    ]);

    const tokens = await requestJson(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: input.config.clientId,
          redirect_uri: input.config.redirectUri,
          code: input.code,
          code_verifier: input.verifier,
        }),
      },
      deadline,
    );

    const authorizedAt = input.now ? input.now() : new Date();
    const expiresIn = tokens.expires_in;

    if (
      !(authorizedAt instanceof Date) ||
      !Number.isFinite(authorizedAt.getTime()) ||
      typeof expiresIn !== "number" ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn <= 0 ||
      typeof tokens.token_type !== "string" ||
      tokens.token_type.toLowerCase() !== "bearer"
    ) {
      throw new SpotifyProviderError();
    }

    const accessExpiresAt = new Date(authorizedAt.getTime() + expiresIn * 1000);
    if (!Number.isFinite(accessExpiresAt.getTime())) {
      throw new SpotifyProviderError();
    }

    const accessToken = credential(tokens.access_token);
    const refreshToken = credential(tokens.refresh_token);

    if (
      tokens.scope !== undefined &&
      (typeof tokens.scope !== "string" || tokens.scope.length > 4096)
    ) {
      throw new SpotifyProviderError();
    }

    const scopeText =
      typeof tokens.scope === "string" ? tokens.scope.trim() : "";
    const grantedScopes = scopeText ? [...new Set(scopeText.split(/\s+/))] : [];
    if (grantedScopes.some((scope) => !/^[a-z][a-z0-9-]{0,127}$/.test(scope))) {
      throw new SpotifyProviderError();
    }

    const profile = await requestJson(
      "https://api.spotify.com/v1/me",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      deadline,
    );

    const accountId = profile.account_id;
    const displayName = profile.display_name ?? null;

    if (
      typeof accountId !== "string" ||
      accountId.length === 0 ||
      accountId.length > 256 ||
      /\s/.test(accountId) ||
      (displayName !== null &&
        (typeof displayName !== "string" || displayName.length > 256))
    ) {
      throw new SpotifyProviderError();
    }

    return {
      accountId,
      displayName,
      accessToken,
      refreshToken,
      grantedScopes,
      authorizedAt: new Date(authorizedAt.getTime()),
      accessExpiresAt,
    };
  } catch (error) {
    if (error instanceof SpotifyProviderError) throw error;
    throw new SpotifyProviderError();
  }
}
