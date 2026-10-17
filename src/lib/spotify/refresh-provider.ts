import type { SpotifyConfig } from "./config";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

type RefreshFailureCode =
  | "invalid_request"
  | "operation_aborted"
  | "invalid_grant"
  | "access_restricted"
  | "rate_limited"
  | "provider_error";

type RefreshOutcome = "not_sent" | "rejected" | "invalid_grant" | "ambiguous";

export class SpotifyRefreshProviderError extends Error {
  constructor(
    public readonly code: RefreshFailureCode,
    public readonly outcome: RefreshOutcome,
    public readonly retryAfterSeconds?: number,
  ) {
    super("Spotify refresh request failed");
    this.name = "SpotifyRefreshProviderError";
  }
}

export type SpotifyRefreshResult = {
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: Date;
  grantedScopes?: string[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid response");
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
    throw new Error("Invalid credential");
  }
  return value;
}

function currentTime(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Invalid clock");
  }
  return new Date(value.getTime());
}

export function parseSpotifyRetryAfter(
  value: string | null,
  now: Date,
): number | undefined {
  if (value === null) return undefined;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }

  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toUTCString() !== value
  ) {
    return undefined;
  }

  return Math.max(0, Math.ceil((timestamp - now.getTime()) / 1000));
}

// Also bounds mocked transports/body readers that do not implement abort.
export async function withinSignal<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;

  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Operation aborted"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });

  try {
    return await Promise.race([work, cancelled]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export async function boundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing body");

  const chunks: Uint8Array[] = [];
  let length = 0;
  let completed = false;

  try {
    while (true) {
      const chunk = await withinSignal(reader.read(), signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65_536) throw new Error("Oversized body");
      chunks.push(chunk.value);
    }
    completed = true;

    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return record(JSON.parse(text));
  } finally {
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// Backend only. Returns plaintext credentials solely for encrypted persistence.
// Never expose this result through a route or log it. Token POSTs are not retried.
export async function refreshSpotifyCredentials(input: {
  refreshToken: string;
  config: EnabledSpotifyConfig;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<SpotifyRefreshResult> {
  const now = input.now ?? (() => new Date());
  let dispatched = false;

  try {
    if (
      !input.config.enabled ||
      !/^[a-f0-9]{32}$/i.test(input.config.clientId)
    ) {
      throw new Error("Invalid configuration");
    }
    const refreshToken = credential(input.refreshToken);
    currentTime(now);

    const signal = AbortSignal.any([
      AbortSignal.timeout(10_000),
      ...(input.signal ? [input.signal] : []),
    ]);
    if (signal.aborted) {
      throw new SpotifyRefreshProviderError("operation_aborted", "not_sent");
    }

    dispatched = true;
    const response = await withinSignal(
      fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: input.config.clientId,
        }),
        redirect: "error",
        cache: "no-store",
        signal,
      }),
      signal,
    );

    if (!response.ok) {
      if (response.status === 400) {
        const error = await boundedJson(response, signal);
        if (error.error === "invalid_grant") {
          throw new SpotifyRefreshProviderError("invalid_grant", "invalid_grant");
        }
        throw new SpotifyRefreshProviderError("provider_error", "rejected");
      }

      const retryAfter = response.status === 429
        ? parseSpotifyRetryAfter(response.headers.get("retry-after"), currentTime(now))
        : undefined;
      void response.body?.cancel().catch(() => undefined);

      throw new SpotifyRefreshProviderError(
        response.status === 403
          ? "access_restricted"
          : response.status === 429
            ? "rate_limited"
            : "provider_error",
        response.status >= 400 && response.status < 500
          ? "rejected"
          : "ambiguous",
        retryAfter,
      );
    }

    const tokens = await boundedJson(response, signal);
    const receivedAt = currentTime(now);
    const expiresIn = tokens.expires_in;

    if (
      typeof expiresIn !== "number" ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn <= 0 ||
      typeof tokens.token_type !== "string" ||
      tokens.token_type.toLowerCase() !== "bearer"
    ) {
      throw new Error("Invalid token metadata");
    }

    const accessExpiresAt = new Date(receivedAt.getTime() + expiresIn * 1000);
    if (!Number.isFinite(accessExpiresAt.getTime())) {
      throw new Error("Invalid expiry");
    }

    const accessToken = credential(tokens.access_token);
    const replacement = tokens.refresh_token === undefined
      ? undefined
      : credential(tokens.refresh_token);

    let grantedScopes: string[] | undefined;
    if (tokens.scope !== undefined) {
      if (typeof tokens.scope !== "string" || tokens.scope.length > 4096) {
        throw new Error("Invalid scopes");
      }
      const scopeText = tokens.scope.trim();
      grantedScopes = scopeText ? [...new Set(scopeText.split(/\s+/))] : [];
      if (grantedScopes.some(scope => !/^[a-z][a-z0-9-]{0,127}$/.test(scope))) {
        throw new Error("Invalid scopes");
      }
    }

    signal.throwIfAborted();
    return {
      accessToken,
      accessExpiresAt,
      ...(replacement === undefined ? {} : { refreshToken: replacement }),
      ...(grantedScopes === undefined ? {} : { grantedScopes }),
    };
  } catch (error) {
    if (error instanceof SpotifyRefreshProviderError) throw error;
    throw new SpotifyRefreshProviderError(
      dispatched ? "provider_error" : "invalid_request",
      dispatched ? "ambiguous" : "not_sent",
    );
  }
}
