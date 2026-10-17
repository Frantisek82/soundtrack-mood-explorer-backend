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
import { disconnectSpotifyAccount } from "@/lib/spotify/disconnect";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { createSpotifyOAuthTransaction } from "@/lib/spotify/transactions";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import User from "@/models/User";

const config: Extract<SpotifyConfig, { enabled: true }> = {
  enabled: true,
  clientId: "a".repeat(32),
  frontendOrigin: "http://127.0.0.1:3001",
  redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
  encryptionKeys: new Map([["test", Buffer.alloc(32, 1)]]),
  activeKeyId: "test",
};

function authorization(suffix: string) {
  const now = Date.now();
  return {
    accountId: `test-only-disconnect-${suffix}`,
    displayName: "Test Listener",
    accessToken: "test-only-access",
    refreshToken: "test-only-refresh",
    grantedScopes: [],
    authorizedAt: new Date(now),
    accessExpiresAt: new Date(now + 3_600_000),
  };
}

async function fixture(suffix = "owner") {
  const user = await User.create({
    name: "Disconnect User",
    email: `disconnect-${suffix}@example.com`,
    password: "test-only-password",
  });
  const userId = user._id.toString();

  await persistSpotifyAccountLink({
    userId,
    generation: 0,
    authorization: authorization(suffix),
    config,
  });

  for (let index = 0; index < 2; index += 1) {
    await createSpotifyOAuthTransaction({
      userId,
      generation: 0,
      sessionToken: "test-only-application-session",
      config,
    });
  }

  return userId;
}

async function generation(userId: string) {
  const user = await User.findById(userId).select("+spotifyLinkGeneration");
  return user?.spotifyLinkGeneration;
}

describe("Transactional Spotify disconnect", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden during disconnect"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("increments generation and removes the entire connection and all transactions", async () => {
    const userId = await fixture();

    await expect(disconnectSpotifyAccount(userId)).resolves.toBe(1);

    await expect(generation(userId)).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);
    await expect(User.exists({ _id: userId })).resolves.not.toBeNull();
  });

  it("keeps repeated disconnects safe", async () => {
    const userId = await fixture();
    await disconnectSpotifyAccount(userId);

    await expect(disconnectSpotifyAccount(userId)).resolves.toBe(2);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);
    await expect(generation(userId)).resolves.toBe(2);
  });

  it("works for a user who has never linked Spotify", async () => {
    const user = await User.create({
      name: "Unlinked User",
      email: "unlinked-disconnect@example.com",
      password: "test-only-password",
    });

    await expect(disconnectSpotifyAccount(user._id.toString())).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it("does not remove another user's connection or transactions", async () => {
    const userId = await fixture();
    const otherId = await fixture("other");

    await disconnectSpotifyAccount(userId);

    await expect(SpotifyConnection.countDocuments({ userId: otherId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId: otherId })).resolves.toBe(2);
    await expect(generation(otherId)).resolves.toBe(0);
  });

  it("rolls back connection deletion and generation when transaction cleanup fails", async () => {
    const userId = await fixture();
    vi.spyOn(SpotifyOAuthTransaction, "deleteMany").mockImplementationOnce(() => {
      throw new Error("test-only-cleanup-failure");
    });

    await expect(disconnectSpotifyAccount(userId))
      .rejects.toThrow("test-only-cleanup-failure");

    await expect(generation(userId)).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(2);
  });

  it("rejects old account-link persistence after disconnect", async () => {
    const userId = await fixture();
    await disconnectSpotifyAccount(userId);

    await expect(persistSpotifyAccountLink({
      userId,
      generation: 0,
      authorization: authorization("owner"),
      config,
    })).rejects.toMatchObject({ code: "stale_spotify_generation" });

    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
  });

  it("allows a new-generation reconnect and rejects an older generation afterward", async () => {
    const userId = await fixture();
    const nextGeneration = await disconnectSpotifyAccount(userId);

    await persistSpotifyAccountLink({
      userId,
      generation: nextGeneration,
      authorization: authorization("owner"),
      config,
    });

    await expect(persistSpotifyAccountLink({
      userId,
      generation: 0,
      authorization: authorization("owner"),
      config,
    })).rejects.toMatchObject({ code: "stale_spotify_generation" });

    const connection = await SpotifyConnection.findOne({ userId });
    expect(connection?.generation).toBe(1);
    expect(connection?.status).toBe("connected");
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
  });

  it("rejects a deleted application User", async () => {
    const userId = await fixture();
    await User.deleteOne({ _id: userId });

    await expect(disconnectSpotifyAccount(userId)).rejects.toMatchObject({
      code: "stale_spotify_generation",
    });
  });
});
