import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpotifyConfig } from "@/lib/spotify/config";
import {
  parseSpotifyRetryAfter,
  refreshSpotifyCredentials,
  SpotifyRefreshProviderError,
} from "@/lib/spotify/refresh-provider";

const config: Extract<SpotifyConfig, { enabled: true }> = {
  enabled: true,
  clientId: "a".repeat(32),
  frontendOrigin: "http://127.0.0.1:3001",
  redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
  encryptionKeys: new Map([["test", Buffer.alloc(32, 1)]]),
  activeKeyId: "test",
};

const now = () => new Date("2026-10-16T12:00:00.000Z");

function validTokens() {
  return {
    access_token: "test-only-new-access",
    token_type: "Bearer",
    expires_in: 3600,
  };
}

function refresh(signal?: AbortSignal) {
  return refreshSpotifyCredentials({
    refreshToken: "test-only-old-refresh",
    config,
    now,
    signal,
  });
}

describe("Spotify refresh HTTP boundary", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Unexpected provider request"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses one PKCE refresh POST without a client secret", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(validTokens()));

    const result = await refresh();
    expect(result).toEqual({
      accessToken: "test-only-new-access",
      accessExpiresAt: new Date("2026-10-16T13:00:00.000Z"),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(options?.method).toBe("POST");
    expect(options?.cache).toBe("no-store");
    expect(options?.redirect).toBe("error");
    expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    expect(Object.fromEntries(options?.body as URLSearchParams)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "test-only-old-refresh",
      client_id: config.clientId,
    });
  });

  it("returns an optional replacement and normalized scopes", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      ...validTokens(),
      refresh_token: "test-only-replacement",
      scope: "user-read-email user-read-email",
    }));

    await expect(refresh()).resolves.toEqual({
      accessToken: "test-only-new-access",
      refreshToken: "test-only-replacement",
      grantedScopes: ["user-read-email"],
      accessExpiresAt: new Date("2026-10-16T13:00:00.000Z"),
    });
  });

  it("recognizes explicit empty scopes", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      ...validTokens(), scope: "",
    }));
    expect((await refresh()).grantedScopes).toEqual([]);
  });

  it("recognizes invalid_grant without returning provider text", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      error: "invalid_grant",
      error_description: "test-only-private-provider-text",
    }, { status: 400 }));

    await expect(refresh()).rejects.toMatchObject({
      code: "invalid_grant",
      outcome: "invalid_grant",
      message: "Spotify refresh request failed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "provider_error", "rejected"],
    [401, "provider_error", "rejected"],
    [403, "access_restricted", "rejected"],
    [429, "rate_limited", "rejected"],
    [500, "provider_error", "ambiguous"],
    [503, "provider_error", "ambiguous"],
  ])("does not replay a token POST after HTTP %s", async (status, code, outcome) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(
      { error: "test-only-provider-error" },
      { status, headers: { "Retry-After": "3" } },
    ));

    await expect(refresh()).rejects.toMatchObject({ code, outcome });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains valid Retry-After metadata without sleeping or retrying", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 429, headers: { "Retry-After": "3" },
    }));

    await expect(refresh()).rejects.toMatchObject({
      retryAfterSeconds: 3,
      outcome: "rejected",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { access_token: "" },
    { access_token: "token with spaces" },
    { token_type: "Basic" },
    { expires_in: 0 },
    { expires_in: -1 },
    { expires_in: 1.5 },
    { expires_in: "3600" },
    { expires_in: Number.MAX_SAFE_INTEGER },
    { refresh_token: "" },
    { refresh_token: null },
    { scope: ["user-read-email"] },
    { scope: "invalid_scope" },
  ])("rejects malformed success responses without partial results: %j", async (patch) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      ...validTokens(), ...patch,
    }));

    await expect(refresh()).rejects.toMatchObject({
      outcome: "ambiguous",
      message: "Spotify refresh request failed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes network failure and treats its outcome as ambiguous", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error("test-only-private-network-details"),
    );

    await expect(refresh()).rejects.toMatchObject({
      outcome: "ambiguous",
      message: "Spotify refresh request failed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an already-aborted operation without dispatch", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(refresh(controller.signal)).rejects.toMatchObject({
      code: "operation_aborted",
      outcome: "not_sent",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds an in-flight request even if the transport ignores abort", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    const pending = refresh(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ outcome: "ambiguous" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds an incomplete response body", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({ start() {} }),
    ));

    const pending = refresh(controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(SpotifyRefreshProviderError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["not-json", JSON.stringify(null), JSON.stringify([]), "x".repeat(65_537)])(
    "rejects malformed or oversized bodies",
    async body => {
      vi.mocked(fetch).mockResolvedValue(new Response(body));
      await expect(refresh()).rejects.toMatchObject({ outcome: "ambiguous" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not send malformed refresh credentials", async () => {
    await expect(refreshSpotifyCredentials({
      refreshToken: "",
      config,
      now,
    })).rejects.toMatchObject({ outcome: "not_sent" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Spotify Retry-After parsing", () => {
  it.each([
    ["3", 3],
    ["0", 0],
    ["Fri, 16 Oct 2026 12:00:03 GMT", 3],
    ["Fri, 16 Oct 2026 11:00:00 GMT", 0],
    [null, undefined],
    ["-1", undefined],
    ["1.5", undefined],
    ["invalid", undefined],
    ["999999999999999999999", undefined],
  ])("parses %s as %s", (header, expected) => {
    expect(parseSpotifyRetryAfter(header, now())).toBe(expected);
  });
});
