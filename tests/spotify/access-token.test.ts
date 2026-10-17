import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getSpotifyAccessToken } from "@/lib/spotify/access-token";
import type { SpotifyConfig } from "@/lib/spotify/config";
import { decryptSpotifyCredential } from "@/lib/spotify/encryption";
import { invalidateSpotifyLinkGeneration } from "@/lib/spotify/generation";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { acquireSpotifyRefreshLease } from "@/lib/spotify/refresh-lease";
import SpotifyConnection from "@/models/SpotifyConnection";
import User from "@/models/User";

const config: Extract<SpotifyConfig, { enabled: true }> = {
  enabled: true,
  clientId: "a".repeat(32),
  frontendOrigin: "http://127.0.0.1:3001",
  redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
  encryptionKeys: new Map([["test", Buffer.alloc(32, 1)]]),
  activeKeyId: "test",
};

const instant = new Date("2026-10-16T12:00:00.000Z");
const now = () => new Date(instant);

function tokens(extra = {}) {
  return Response.json({
    access_token: "test-only-new-access",
    token_type: "Bearer",
    expires_in: 3600,
    ...extra,
  });
}

async function fixture(expiresInMs = 0) {
  const user = await User.create({
    name: "Access Token User",
    email: "access-token@example.com",
    password: "test-only-password",
  });
  const userId = user._id.toString();
  const authorization = {
    accountId: "test-only-access-account",
    displayName: "Test Listener",
    accessToken: "test-only-old-access",
    refreshToken: "test-only-old-refresh",
    grantedScopes: [],
    authorizedAt: new Date(instant.getTime() - 3_600_000),
    accessExpiresAt: new Date(instant.getTime() + expiresInMs),
  };

  await persistSpotifyAccountLink({
    userId, generation: 0, authorization, config,
  });

  return {
    input: { userId, generation: 0, config, now },
    authorization,
  };
}

describe("Backend Spotify access-token service", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Unexpected provider request"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a usable stored token without contacting Spotify", async () => {
    const { input } = await fixture(3_600_000);
    await expect(getSpotifyAccessToken(input)).resolves.toEqual({
      accessToken: "test-only-old-access",
      tokenVersion: 0,
      generation: 0,
      refreshPerformed: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses a stored token just beyond the refresh margin", async () => {
    const { input } = await fixture(60_001);
    expect((await getSpotifyAccessToken(input)).tokenVersion).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes at the exact 60-second boundary and preserves an omitted refresh token", async () => {
    const { input } = await fixture(60_000);
    const before = await SpotifyConnection.collection.findOne({});
    vi.mocked(fetch).mockResolvedValue(tokens());

    await expect(getSpotifyAccessToken(input)).resolves.toEqual({
      accessToken: "test-only-new-access",
      tokenVersion: 1,
      generation: 0,
      refreshPerformed: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.refreshToken).toEqual(before?.refreshToken);
    expect(stored?.originalAuthorizedAt).toEqual(before?.originalAuthorizedAt);
    expect(stored?.estimatedRefreshExpiry).toEqual(before?.estimatedRefreshExpiry);
  });

  it("persists encrypted replacement refresh credentials", async () => {
    const { input } = await fixture();
    vi.mocked(fetch).mockResolvedValue(tokens({
      refresh_token: "test-only-replacement",
    }));
    await getSpotifyAccessToken(input);

    const stored = await SpotifyConnection.collection.findOne({});
    expect(decryptSpotifyCredential(stored?.refreshToken, {
      userId: input.userId, generation: 0, purpose: "refresh_token",
    }, config)).toBe("test-only-replacement");
    expect(JSON.stringify(stored)).not.toContain("test-only-replacement");
  });

  it("does not treat the configured refresh lifetime estimate as provider authority", async () => {
    const { input } = await fixture();
    await SpotifyConnection.updateOne({}, {
      $set: { estimatedRefreshExpiry: new Date("2020-01-01") },
    });
    vi.mocked(fetch).mockResolvedValue(tokens());
    expect((await getSpotifyAccessToken(input)).accessToken).toBe("test-only-new-access");
    expect((await SpotifyConnection.collection.findOne({}))?.estimatedRefreshExpiry)
      .toEqual(new Date("2020-01-01"));
  });

  it.each([
    [400, { error: "invalid_grant" }],
    [500, { error: "test-only-provider-error" }],
  ])("requires reauthorization after unsafe HTTP %s without a retry", async (status, body) => {
    const { input } = await fixture();
    vi.mocked(fetch).mockResolvedValue(Response.json(body, { status }));

    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "reauthorization_required",
    });
    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "reauthorization_required",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.accessToken).toBeUndefined();
    expect(stored?.refreshToken).toBeUndefined();
    expect(stored?.accountId).toBe("test-only-access-account");
  });

  it("preserves connection state after a definite 403 rejection", async () => {
    const { input } = await fixture();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }));
    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not replay a 429 during the stored cooldown", async () => {
    const { input } = await fixture();
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 429, headers: { "Retry-After": "120" },
    }));
    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "unavailable", retryAfterSeconds: 120,
    });
    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "refresh_busy", retryAfterSeconds: 120,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it("treats a network failure as an uncertain refresh without replay", async () => {
    const { input } = await fixture();
    vi.mocked(fetch).mockRejectedValue(new Error("test-only-private-network-details"));
    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "reauthorization_required",
      message: "Spotify access unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent callers", async () => {
    const { input } = await fixture();
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => {
      release = resolve;
    }));

    const first = getSpotifyAccessToken(input);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const second = getSpotifyAccessToken(input);
    const third = getSpotifyAccessToken(input);
    release(tokens());

    const results = await Promise.all([first, second, third]);
    expect(results.map(result => result.accessToken)).toEqual([
      "test-only-new-access",
      "test-only-new-access",
      "test-only-new-access",
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["disconnect", "delete"])(
    "discards results after %s during provider HTTP",
    async action => {
      const { input } = await fixture();
      vi.mocked(fetch).mockImplementation(async () => {
        await invalidateSpotifyLinkGeneration(input.userId, async session => {
          await SpotifyConnection.deleteMany({ userId: input.userId }).session(session);
          if (action === "delete") {
            await User.deleteOne({ _id: input.userId }).session(session);
          }
        });
        return tokens();
      });

      await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
        code: "connection_changed",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    },
  );

  it("does not overwrite a reauthorization completed during refresh", async () => {
    const { input, authorization } = await fixture();
    vi.mocked(fetch).mockImplementation(async () => {
      await persistSpotifyAccountLink({
        ...input,
        authorization: {
          ...authorization,
          accessToken: "test-only-reauthorized-access",
          accessExpiresAt: new Date(instant.getTime() + 3_600_000),
        },
      });
      return tokens();
    });

    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "connection_changed",
    });
    expect((await getSpotifyAccessToken(input)).accessToken)
      .toBe("test-only-reauthorized-access");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("recovers an abandoned expired lease without reusing its refresh token", async () => {
    const { input } = await fixture();
    await acquireSpotifyRefreshLease({
      ...input, tokenVersion: 0,
      now: () => new Date(instant.getTime() - 30_000),
    });

    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "reauthorization_required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an already-aborted operation without provider HTTP", async () => {
    const { input } = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(getSpotifyAccessToken({
      ...input, signal: controller.signal,
    })).rejects.toMatchObject({ code: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forces refresh for a token version rejected by a provider GET", async () => {
    const { input } = await fixture(3_600_000);
    vi.mocked(fetch).mockResolvedValue(tokens());
    const result = await getSpotifyAccessToken({
      ...input, forceRefreshTokenVersion: 0,
    });
    expect(result.tokenVersion).toBe(1);

    const shared = await getSpotifyAccessToken({
      ...input, forceRefreshTokenVersion: 0,
    });
    expect(shared.tokenVersion).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing connection without creating one", async () => {
    const { input } = await fixture();
    await SpotifyConnection.deleteMany({});
    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a deleted application User before provider HTTP", async () => {
    const { input } = await fixture(3_600_000);
    await User.deleteMany({});
    await expect(getSpotifyAccessToken(input)).rejects.toMatchObject({
      code: "connection_changed",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
