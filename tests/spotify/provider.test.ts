import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  authorizeSpotifyAccount,
  SpotifyProviderError,
} from "@/lib/spotify/provider";

const fetchMock = vi.fn<typeof fetch>();

const tokens = {
  access_token: "test-only-access",
  refresh_token: "test-only-refresh",
  token_type: "Bearer",
  expires_in: 3600,
  scope: "",
};

function input() {
  const config = getSpotifyConfig({
    SPOTIFY_ENABLED: "true",
    SPOTIFY_CLIENT_ID: "a".repeat(32),
    SPOTIFY_FRONTEND_ORIGIN: "http://127.0.0.1:3001",
    SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/spotify/callback",
    SPOTIFY_TOKEN_ENCRYPTION_KEYS: JSON.stringify({
      test: Buffer.alloc(32, 1).toString("base64"),
    }),
    SPOTIFY_TOKEN_ACTIVE_KEY_ID: "test",
  });
  if (!config.enabled) throw new Error("Expected enabled configuration");

  return {
    code: "test-only-code",
    verifier: Buffer.alloc(32, 1).toString("base64url"),
    config,
    now: () => new Date("2026-10-15T16:00:00Z"),
  };
}

function json(value: unknown): Response {
  return Response.json(value);
}

describe("Spotify authorization HTTP boundary", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("Unexpected provider request"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses PKCE form exchange and returns only normalized backend data", async () => {
    fetchMock.mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(
      json({
        account_id: "stable-test-account",
        id: "mutable-test-id",
        display_name: "Test Listener",
        email: "unused@example.com",
        images: [{ url: "https://example.com/unused.png" }],
      }),
    );

    const data = input();
    const result = await authorizeSpotifyAccount(data);

    expect(result).toEqual({
      accountId: "stable-test-account",
      displayName: "Test Listener",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      grantedScopes: [],
      authorizedAt: new Date("2026-10-15T16:00:00Z"),
      accessExpiresAt: new Date("2026-10-15T17:00:00Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenOptions] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://accounts.spotify.com/api/token");
    expect(tokenOptions?.method).toBe("POST");
    expect(
      Object.fromEntries(new URLSearchParams(String(tokenOptions?.body))),
    ).toEqual({
      grant_type: "authorization_code",
      client_id: data.config.clientId,
      redirect_uri: data.config.redirectUri,
      code: data.code,
      code_verifier: data.verifier,
    });
    expect(new Headers(tokenOptions?.headers).has("Authorization")).toBe(false);
    expect(tokenOptions?.redirect).toBe("error");
    expect(tokenOptions?.cache).toBe("no-store");
    expect(tokenOptions?.signal).toBeInstanceOf(AbortSignal);

    const [profileUrl, profileOptions] = fetchMock.mock.calls[1];
    expect(profileUrl).toBe("https://api.spotify.com/v1/me");
    expect(new Headers(profileOptions?.headers).get("Authorization")).toBe(
      "Bearer test-only-access",
    );
  });

  it.each([
    { access_token: "" },
    { refresh_token: undefined },
    { token_type: "unexpected" },
    { expires_in: 0 },
    { expires_in: 1.5 },
    { expires_in: Number.MAX_SAFE_INTEGER },
    { scope: 123 },
  ])(
    "rejects malformed token responses before fetching a profile",
    async (change) => {
      fetchMock.mockResolvedValueOnce(json({ ...tokens, ...change }));

      await expect(authorizeSpotifyAccount(input())).rejects.toBeInstanceOf(
        SpotifyProviderError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { id: "must-not-be-used", email: "must-not-be-used@example.com" },
    { account_id: "" },
    { account_id: "contains whitespace" },
    { account_id: "valid", display_name: 123 },
  ])("rejects invalid identity without a linking fallback", async (profile) => {
    fetchMock
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(json(profile));

    await expect(authorizeSpotifyAccount(input())).rejects.toBeInstanceOf(
      SpotifyProviderError,
    );
  });

  it("accepts an unavailable display name", async () => {
    fetchMock
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(json({ account_id: "stable-test-account" }));

    await expect(authorizeSpotifyAccount(input())).resolves.toHaveProperty(
      "displayName",
      null,
    );
  });

  it.each([400, 401, 403, 429, 500])(
    "does not replay token exchange after HTTP %s",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response("test-only-private-provider-error", {
          status,
          headers: { "Retry-After": "12" },
        }),
      );

      await expect(authorizeSpotifyAccount(input())).rejects.toMatchObject({
        message: "Spotify provider request failed",
        code:
          status === 403
            ? "access_restricted"
            : status === 429
              ? "rate_limited"
              : "provider_error",
        retryAfterSeconds: status === 429 ? 12 : undefined,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 429, 503])(
    "rejects profile HTTP %s without repeating authorization",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(json(tokens))
        .mockResolvedValueOnce(new Response(null, { status }));

      await expect(authorizeSpotifyAccount(input())).rejects.toBeInstanceOf(
        SpotifyProviderError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("sanitizes network failures without retrying the code", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error("test-only-private-code-and-token-details"),
    );

    await expect(authorizeSpotifyAccount(input())).rejects.toMatchObject({
      message: "Spotify provider request failed",
      code: "provider_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles timeout failures without replaying the code", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException("Test timeout", "TimeoutError"),
    );

    await expect(authorizeSpotifyAccount(input())).rejects.toBeInstanceOf(
      SpotifyProviderError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an already-aborted operation before making a request", async () => {
    await expect(
      authorizeSpotifyAccount({
        ...input(),
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeInstanceOf(SpotifyProviderError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not-json"));

    await expect(authorizeSpotifyAccount(input())).rejects.toBeInstanceOf(
      SpotifyProviderError,
    );
  });

  it("rejects oversized provider bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("a".repeat(65_537)));

    await expect(authorizeSpotifyAccount(input())).rejects.toBeInstanceOf(
      SpotifyProviderError,
    );
  });
});
