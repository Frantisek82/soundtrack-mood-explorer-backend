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
import { decryptSpotifyCredential } from "@/lib/spotify/encryption";
import { invalidateSpotifyLinkGeneration } from "@/lib/spotify/generation";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { acquireSpotifyRefreshLease } from "@/lib/spotify/refresh-lease";
import {
  persistSpotifyRefresh,
  settleSpotifyRefreshFailure,
} from "@/lib/spotify/refresh-persistence";
import {
  SpotifyRefreshProviderError,
  type SpotifyRefreshResult,
} from "@/lib/spotify/refresh-provider";
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

function refreshed(): SpotifyRefreshResult {
  return {
    accessToken: "test-only-new-access",
    accessExpiresAt: new Date(instant.getTime() + 3_600_000),
  };
}

async function fixture() {
  const user = await User.create({
    name: "Refresh Persistence User",
    email: "refresh-persistence@example.com",
    password: "test-only-password",
  });
  const userId = user._id.toString();
  const authorization = {
    accountId: "test-only-persistence-account",
    displayName: "Test Listener",
    accessToken: "test-only-old-access",
    refreshToken: "test-only-old-refresh",
    grantedScopes: ["user-read-email"],
    authorizedAt: new Date(instant.getTime() - 3_600_000),
    accessExpiresAt: new Date(instant.getTime() - 1),
  };

  await persistSpotifyAccountLink({
    userId, generation: 0, authorization, config,
  });
  const acquired = await acquireSpotifyRefreshLease({
    userId, generation: 0, tokenVersion: 0, now,
  });
  if (acquired.state !== "acquired") throw new Error("Expected lease");
  return { lease: acquired.lease, authorization };
}

describe("Spotify refresh persistence", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden in persistence"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("encrypts access credentials, preserves an omitted refresh token and lifetime", async () => {
    const { lease } = await fixture();
    const before = await SpotifyConnection.collection.findOne({});
    await expect(persistSpotifyRefresh({
      lease, result: refreshed(), config, now,
    })).resolves.toBe(true);

    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.refreshToken).toEqual(before?.refreshToken);
    expect(stored?.originalAuthorizedAt).toEqual(before?.originalAuthorizedAt);
    expect(stored?.estimatedRefreshExpiry).toEqual(before?.estimatedRefreshExpiry);
    expect(stored?.grantedScopes).toEqual(before?.grantedScopes);
    expect(stored?.tokenVersion).toBe(1);
    expect(stored?.refreshLeaseOwner).toBeUndefined();
    expect(stored?.refreshLeaseExpiresAt).toBeUndefined();
    expect(stored?.accessExpiresAt).toEqual(refreshed().accessExpiresAt);
    expect(decryptSpotifyCredential(stored?.accessToken, {
      userId: lease.userId, generation: 0, purpose: "access_token",
    }, config)).toBe("test-only-new-access");
    expect(JSON.stringify(stored)).not.toContain("test-only-new-access");
  });

  it("encrypts a replacement refresh token and applies explicit scopes", async () => {
    const { lease } = await fixture();
    await persistSpotifyRefresh({
      lease,
      result: {
        ...refreshed(),
        refreshToken: "test-only-new-refresh",
        grantedScopes: [],
      },
      config,
      now,
    });

    const stored = await SpotifyConnection.collection.findOne({});
    expect(decryptSpotifyCredential(stored?.refreshToken, {
      userId: lease.userId, generation: 0, purpose: "refresh_token",
    }, config)).toBe("test-only-new-refresh");
    expect(stored?.grantedScopes).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain("test-only-new-refresh");
  });

  it("allows a successful lease result to be persisted only once", async () => {
    const { lease } = await fixture();
    const input = { lease, result: refreshed(), config, now };
    await expect(persistSpotifyRefresh(input)).resolves.toBe(true);
    await expect(persistSpotifyRefresh(input)).resolves.toBe(false);
  });

  it("rejects a different lease owner", async () => {
    const { lease } = await fixture();
    await expect(persistSpotifyRefresh({
      lease: { ...lease, owner: "different-owner" },
      result: refreshed(), config, now,
    })).resolves.toBe(false);
    expect((await SpotifyConnection.collection.findOne({}))?.tokenVersion).toBe(0);
  });

  it("rejects persistence at the exact lease expiry boundary", async () => {
    const { lease } = await fixture();
    await expect(persistSpotifyRefresh({
      lease, result: refreshed(), config,
      now: () => new Date(lease.expiresAt),
    })).resolves.toBe(false);
  });

  it("does not overwrite credentials from same-account reauthorization", async () => {
    const { lease, authorization } = await fixture();
    await persistSpotifyAccountLink({
      userId: lease.userId,
      generation: 0,
      authorization: {
        ...authorization,
        accessToken: "test-only-reauthorized-access",
      },
      config,
    });

    await expect(persistSpotifyRefresh({
      lease, result: refreshed(), config, now,
    })).resolves.toBe(false);
    const stored = await SpotifyConnection.collection.findOne({});
    expect(decryptSpotifyCredential(stored?.accessToken, {
      userId: lease.userId, generation: 0, purpose: "access_token",
    }, config)).toBe("test-only-reauthorized-access");
  });

  it("never upserts a deleted connection", async () => {
    const { lease } = await fixture();
    await SpotifyConnection.deleteMany({});
    await expect(persistSpotifyRefresh({
      lease, result: refreshed(), config, now,
    })).resolves.toBe(false);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it.each(["generation", "deletion"])(
    "rejects a result after User %s invalidation",
    async kind => {
      const { lease } = await fixture();
      await invalidateSpotifyLinkGeneration(lease.userId, async session => {
        await SpotifyConnection.deleteMany({ userId: lease.userId }).session(session);
        if (kind === "deletion") {
          await User.deleteOne({ _id: lease.userId }).session(session);
        }
      });

      await expect(persistSpotifyRefresh({
        lease, result: refreshed(), config, now,
      })).rejects.toMatchObject({ code: "stale_spotify_generation" });
      await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    },
  );

  it.each(["invalid_grant", "ambiguous"] as const)(
    "discards credentials after %s while retaining linking identity",
    async outcome => {
      const { lease } = await fixture();
      await expect(settleSpotifyRefreshFailure({
        lease,
        error: new SpotifyRefreshProviderError(
          outcome === "invalid_grant" ? "invalid_grant" : "provider_error",
          outcome,
        ),
        now,
      })).resolves.toBe(true);

      const stored = await SpotifyConnection.collection.findOne({});
      expect(stored?.status).toBe("reauthorization_required");
      expect(stored?.accessToken).toBeUndefined();
      expect(stored?.refreshToken).toBeUndefined();
      expect(stored?.accessExpiresAt).toBeUndefined();
      expect(stored?.refreshLeaseOwner).toBeUndefined();
      expect(stored?.tokenVersion).toBe(1);
      expect(stored?.accountId).toBe("test-only-persistence-account");
    },
  );

  it("preserves credentials and honors a 429 cooldown", async () => {
    const { lease } = await fixture();
    const before = await SpotifyConnection.collection.findOne({});
    await settleSpotifyRefreshFailure({
      lease,
      error: new SpotifyRefreshProviderError("rate_limited", "rejected", 120),
      now,
    });

    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.status).toBe("connected");
    expect(stored?.accessToken).toEqual(before?.accessToken);
    expect(stored?.refreshToken).toEqual(before?.refreshToken);
    expect(stored?.refreshLeaseOwner).toBeUndefined();
    expect(stored?.refreshLeaseExpiresAt).toEqual(
      new Date(instant.getTime() + 120_000),
    );
    expect(stored?.tokenVersion).toBe(1);
  });

  it.each(["rejected", "not_sent"] as const)(
    "preserves connection state after %s",
    async outcome => {
      const { lease } = await fixture();
      const before = await SpotifyConnection.collection.findOne({});
      await settleSpotifyRefreshFailure({
        lease,
        error: new SpotifyRefreshProviderError("provider_error", outcome),
        now,
      });
      const stored = await SpotifyConnection.collection.findOne({});
      expect(stored?.status).toBe("connected");
      expect(stored?.refreshToken).toEqual(before?.refreshToken);
    },
  );

  it("does not apply an old failure to a newly persisted success", async () => {
    const { lease } = await fixture();
    await persistSpotifyRefresh({ lease, result: refreshed(), config, now });
    await expect(settleSpotifyRefreshFailure({
      lease,
      error: new SpotifyRefreshProviderError("invalid_grant", "invalid_grant"),
      now,
    })).resolves.toBe(false);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it("rejects invalid replacement credentials without partial persistence", async () => {
    const { lease } = await fixture();
    const before = await SpotifyConnection.collection.findOne({});
    await expect(persistSpotifyRefresh({
      lease,
      result: { ...refreshed(), refreshToken: "" },
      config,
      now,
    })).rejects.toThrow();
    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored).toEqual(before);
  });

  it("rejects invalid expiry without partial persistence", async () => {
    const { lease } = await fixture();
    const before = await SpotifyConnection.collection.findOne({});
    await expect(persistSpotifyRefresh({
      lease,
      result: { ...refreshed(), accessExpiresAt: new Date(instant) },
      config,
      now,
    })).rejects.toThrow("Invalid Spotify access expiry");
    expect(await SpotifyConnection.collection.findOne({})).toEqual(before);
  });
});
