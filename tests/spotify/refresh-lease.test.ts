import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SpotifyConfig } from "@/lib/spotify/config";
import { invalidateSpotifyLinkGeneration } from "@/lib/spotify/generation";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import {
  acquireSpotifyRefreshLease,
  SPOTIFY_REFRESH_LEASE_MS,
} from "@/lib/spotify/refresh-lease";
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

async function fixture() {
  const user = await User.create({
    name: "Refresh Lease User",
    email: "refresh-lease@example.com",
    password: "test-only-password",
  });
  const userId = user._id.toString();

  await persistSpotifyAccountLink({
    userId,
    generation: 0,
    config,
    authorization: {
      accountId: "test-only-lease-account",
      displayName: "Test Listener",
      accessToken: "test-only-access",
      refreshToken: "test-only-refresh",
      grantedScopes: [],
      authorizedAt: new Date(instant.getTime() - 3_600_000),
      accessExpiresAt: new Date(instant.getTime() - 1),
    },
  });

  return {
    userId,
    generation: 0,
    tokenVersion: 0,
    now: () => new Date(instant),
  };
}

describe("Spotify refresh lease acquisition", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden during database coordination"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("acquires a bounded lease without changing credentials or authorization lifetime", async () => {
    const input = await fixture();
    const before = await SpotifyConnection.collection.findOne({
      userId: new User.base.Types.ObjectId(input.userId),
    });

    const result = await acquireSpotifyRefreshLease(input);
    expect(result.state).toBe("acquired");
    if (result.state !== "acquired") throw new Error("Expected lease");

    expect(result.lease.owner).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.lease.tokenVersion).toBe(0);
    expect(result.lease.expiresAt.getTime()).toBe(
      instant.getTime() + SPOTIFY_REFRESH_LEASE_MS,
    );

    const after = await SpotifyConnection.collection.findOne({
      _id: before?._id,
    });
    expect(after?.accessToken).toEqual(before?.accessToken);
    expect(after?.refreshToken).toEqual(before?.refreshToken);
    expect(after?.originalAuthorizedAt).toEqual(before?.originalAuthorizedAt);
    expect(after?.estimatedRefreshExpiry).toEqual(before?.estimatedRefreshExpiry);
    expect(after?.tokenVersion).toBe(0);
    expect(after?.refreshLeaseOwner).toBe(result.lease.owner);
  });

  it("permits only one concurrent lease owner", async () => {
    const input = await fixture();
    const results = await Promise.all([
      acquireSpotifyRefreshLease(input),
      acquireSpotifyRefreshLease(input),
      acquireSpotifyRefreshLease(input),
    ]);

    expect(results.filter(result => result.state === "acquired")).toHaveLength(1);
    expect(results.filter(result => result.state === "busy")).toHaveLength(2);
  });

  it("returns stale for an obsolete token version", async () => {
    const input = await fixture();
    await expect(acquireSpotifyRefreshLease({
      ...input, tokenVersion: 1,
    })).resolves.toEqual({ state: "stale" });
  });

  it("does not upsert a deleted connection", async () => {
    const input = await fixture();
    await SpotifyConnection.deleteMany({});

    await expect(acquireSpotifyRefreshLease(input)).resolves.toEqual({
      state: "stale",
    });
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("invalidates credentials at the exact lease-expiry boundary", async () => {
    const input = await fixture();
    const first = await acquireSpotifyRefreshLease(input);
    if (first.state !== "acquired") throw new Error("Expected lease");

    const result = await acquireSpotifyRefreshLease({
      ...input,
      now: () => new Date(first.lease.expiresAt),
    });
    expect(result).toEqual({ state: "reauthorization_required" });

    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.status).toBe("reauthorization_required");
    expect(stored?.tokenVersion).toBe(1);
    expect(stored?.accessToken).toBeUndefined();
    expect(stored?.refreshToken).toBeUndefined();
    expect(stored?.refreshLeaseOwner).toBeUndefined();
    expect(stored?.refreshLeaseExpiresAt).toBeUndefined();
    expect(stored?.accountId).toBe("test-only-lease-account");
    expect(stored?.originalAuthorizedAt).toBeInstanceOf(Date);
    expect(stored?.estimatedRefreshExpiry).toBeInstanceOf(Date);
  });

  it("fails closed for an owned lease with a missing expiry", async () => {
    const input = await fixture();
    await SpotifyConnection.updateOne({}, {
      $set: { refreshLeaseOwner: "test-only-abandoned-owner" },
    });

    await expect(acquireSpotifyRefreshLease(input)).resolves.toEqual({
      state: "reauthorization_required",
    });
  });

  it("honors an ownerless cooldown and acquires after it ends", async () => {
    const input = await fixture();
    const retryAt = new Date(instant.getTime() + 5_000);
    await SpotifyConnection.updateOne({}, {
      $set: { refreshLeaseExpiresAt: retryAt },
    });

    await expect(acquireSpotifyRefreshLease(input)).resolves.toEqual({
      state: "busy",
      retryAt,
    });
    const result = await acquireSpotifyRefreshLease({
      ...input, now: () => new Date(retryAt),
    });
    expect(result.state).toBe("acquired");
  });

  it("rejects acquisition after generation invalidation", async () => {
    const input = await fixture();
    await invalidateSpotifyLinkGeneration(input.userId, async () => undefined);

    await expect(acquireSpotifyRefreshLease(input)).rejects.toMatchObject({
      code: "stale_spotify_generation",
    });
    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.refreshLeaseOwner).toBeUndefined();
  });

  it("rejects acquisition after User deletion", async () => {
    const input = await fixture();
    await User.deleteMany({});

    await expect(acquireSpotifyRefreshLease(input)).rejects.toMatchObject({
      code: "stale_spotify_generation",
    });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid token version %s",
    async tokenVersion => {
      const input = await fixture();
      await expect(acquireSpotifyRefreshLease({
        ...input, tokenVersion,
      })).rejects.toThrow("Invalid Spotify token version");
    },
  );
});
