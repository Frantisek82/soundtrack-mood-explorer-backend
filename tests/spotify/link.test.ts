import { beforeAll, describe, expect, it } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import { decryptSpotifyCredential } from "@/lib/spotify/encryption";
import {
  invalidateSpotifyLinkGeneration,
  SpotifyGenerationError,
} from "@/lib/spotify/generation";
import {
  persistSpotifyAccountLink,
  SpotifyAccountConflictError,
} from "@/lib/spotify/link";
import type { SpotifyAuthorization } from "@/lib/spotify/provider";
import User from "@/models/User";
import SpotifyConnection from "@/models/SpotifyConnection";

function configuration() {
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
  return config;
}

function authorization(
  overrides: Partial<SpotifyAuthorization> = {},
): SpotifyAuthorization {
  return {
    accountId: "stable-test-account",
    displayName: "Test Listener",
    accessToken: "test-only-access",
    refreshToken: "test-only-refresh",
    grantedScopes: [],
    authorizedAt: new Date("2026-10-15T16:00:00Z"),
    accessExpiresAt: new Date("2026-10-15T17:00:00Z"),
    ...overrides,
  };
}

async function createUser(email = "link@example.com") {
  const user = await User.create({
    name: "Spotify Link User",
    email,
    password: "test-only-password",
  });
  return user._id.toString();
}

function linkInput(userId: string) {
  return {
    userId,
    generation: 0,
    authorization: authorization(),
    config: configuration(),
  };
}

function storedConnection(userId: string) {
  return SpotifyConnection.findOne({ userId })
    .select(
      "+accessToken +refreshToken +refreshLeaseOwner +refreshLeaseExpiresAt",
    )
    .lean();
}

describe("Spotify account-link persistence", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  it("stores encrypted credentials with ownership and lifetime metadata", async () => {
    const userId = await createUser();
    const input = linkInput(userId);

    await expect(persistSpotifyAccountLink(input)).resolves.toBeUndefined();
    const stored = await storedConnection(userId);

    expect(stored).toMatchObject({
      accountId: "stable-test-account",
      generation: 0,
      tokenVersion: 0,
      status: "connected",
      grantedScopes: [],
    });

    expect(
      decryptSpotifyCredential(
        stored?.accessToken,
        { userId, generation: 0, purpose: "access_token" },
        input.config,
      ),
    ).toBe("test-only-access");

    expect(
      decryptSpotifyCredential(
        stored?.refreshToken,
        { userId, generation: 0, purpose: "refresh_token" },
        input.config,
      ),
    ).toBe("test-only-refresh");

    expect(stored?.estimatedRefreshExpiry.getTime()).toBe(
      input.authorization.authorizedAt.getTime() + 180 * 24 * 60 * 60 * 1000,
    );
    expect(JSON.stringify(stored)).not.toContain("test-only-access");
    expect(JSON.stringify(stored)).not.toContain("test-only-refresh");
  });

  it("replaces same-account credentials and invalidates an old refresh lease", async () => {
    const userId = await createUser();
    const input = linkInput(userId);
    await persistSpotifyAccountLink(input);

    await SpotifyConnection.updateOne(
      { userId },
      {
        $set: {
          refreshLeaseOwner: "test-old-lease",
          refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
        },
      },
    );

    const renewed = authorization({
      accessToken: "test-renewed-access",
      refreshToken: "test-renewed-refresh",
      authorizedAt: new Date("2026-10-15T16:01:00Z"),
      accessExpiresAt: new Date("2026-10-15T17:01:00Z"),
    });
    await persistSpotifyAccountLink({ ...input, authorization: renewed });

    const stored = await storedConnection(userId);
    expect(stored?.tokenVersion).toBe(1);
    expect(stored?.originalAuthorizedAt).toEqual(renewed.authorizedAt);
    expect(stored).not.toHaveProperty("refreshLeaseOwner");
    expect(stored).not.toHaveProperty("refreshLeaseExpiresAt");

    expect(
      decryptSpotifyCredential(
        stored?.refreshToken,
        { userId, generation: 0, purpose: "refresh_token" },
        input.config,
      ),
    ).toBe("test-renewed-refresh");
  });

  it("rejects account switching and preserves the existing connection", async () => {
    const userId = await createUser();
    const input = linkInput(userId);
    await persistSpotifyAccountLink(input);
    const before = await storedConnection(userId);

    await expect(
      persistSpotifyAccountLink({
        ...input,
        authorization: authorization({ accountId: "different-account" }),
      }),
    ).rejects.toBeInstanceOf(SpotifyAccountConflictError);

    expect(await storedConnection(userId)).toEqual(before);
  });

  it("rejects a Spotify account already owned by another application user", async () => {
    const first = await createUser();
    const second = await createUser("second-link@example.com");
    await persistSpotifyAccountLink(linkInput(first));

    await expect(
      persistSpotifyAccountLink(linkInput(second)),
    ).rejects.toBeInstanceOf(SpotifyAccountConflictError);

    await expect(
      SpotifyConnection.countDocuments({ userId: second }),
    ).resolves.toBe(0);
  });

  it("allows only one owner when users concurrently link the same account", async () => {
    const first = await createUser();
    const second = await createUser("concurrent-link@example.com");

    const results = await Promise.allSettled([
      persistSpotifyAccountLink(linkInput(first)),
      persistSpotifyAccountLink(linkInput(second)),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(SpotifyAccountConflictError);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(1);
  });

  it("rejects persistence after generation invalidation", async () => {
    const userId = await createUser();
    await invalidateSpotifyLinkGeneration(userId, async () => undefined);

    await expect(
      persistSpotifyAccountLink(linkInput(userId)),
    ).rejects.toBeInstanceOf(SpotifyGenerationError);

    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("rejects persistence after User deletion", async () => {
    const userId = await createUser();
    await User.deleteOne({ _id: userId });

    await expect(
      persistSpotifyAccountLink(linkInput(userId)),
    ).rejects.toBeInstanceOf(SpotifyGenerationError);

    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("preserves existing credentials when replacement validation fails", async () => {
    const userId = await createUser();
    const input = linkInput(userId);
    await persistSpotifyAccountLink(input);
    const before = await storedConnection(userId);

    await expect(
      persistSpotifyAccountLink({
        ...input,
        authorization: authorization({ displayName: "a".repeat(257) }),
      }),
    ).rejects.toThrow();

    expect(await storedConnection(userId)).toEqual(before);
  });
});
