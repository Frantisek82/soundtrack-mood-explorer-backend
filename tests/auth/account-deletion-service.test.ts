import { Types } from "mongoose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  cleanupAcceptedAccountDeletion,
  deleteApplicationAccount,
} from "@/lib/account-deletion";
import type { SpotifyConfig } from "@/lib/spotify/config";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { createSpotifyOAuthTransaction } from "@/lib/spotify/transactions";
import Favorite from "@/models/Favorite";
import Playlist from "@/models/Playlist";
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
  const time = Date.now();
  return {
    accountId: `test-only-deletion-${suffix}`,
    displayName: "Test Listener",
    accessToken: "test-only-access",
    refreshToken: "test-only-refresh",
    grantedScopes: [],
    authorizedAt: new Date(time),
    accessExpiresAt: new Date(time + 3_600_000),
  };
}

async function fixture(suffix = "owner", linked = true) {
  const user = await User.create({
    name: "Account Deletion User",
    email: `account-deletion-${suffix}@example.com`,
    password: "test-only-password",
  });
  const userId = user._id.toString();

  // Raw test-only Favorite fixture: no catalogue or live data is needed
  // to verify the existing owner-based cascade.
  await Favorite.collection.insertOne({
    userId: new Types.ObjectId(userId),
    soundtrackId: new Types.ObjectId(),
  });

  await Playlist.create([
    { userId, name: "First test playlist", soundtracks: [] },
    { userId, name: "Second test playlist", soundtracks: [] },
  ]);

  if (linked) {
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
  }

  return userId;
}

async function expectPreserved(userId: string) {
  const user = await User.findById(userId).select("+spotifyLinkGeneration");
  expect(user).not.toBeNull();
  expect(user?.spotifyLinkGeneration).toBe(0);
  await expect(Favorite.countDocuments({ userId })).resolves.toBe(1);
  await expect(Playlist.countDocuments({ userId })).resolves.toBe(2);
  await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
  await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(2);
}

describe("Transactional application-account deletion", () => {
  beforeAll(async () => {
    await User.init();
    await Favorite.init();
    await Playlist.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden during account deletion"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it("removes the User, Favorites, Spotify connection and all pending transactions", async () => {
    const userId = await fixture();

    await expect(deleteApplicationAccount(userId)).resolves.toBe(1);

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
    await expect(Playlist.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);
  });

  it("preserves another user's account and data", async () => {
    const userId = await fixture();
    const otherId = await fixture("other");

    await deleteApplicationAccount(userId);

    await expectPreserved(otherId);
    await expect(User.findById(userId)).resolves.toBeNull();
  });

  it("preserves existing account deletion for a user without Spotify", async () => {
    const userId = await fixture("unlinked", false);

    await deleteApplicationAccount(userId);

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
    await expect(Playlist.countDocuments({ userId })).resolves.toBe(0);
  });

  it("cleans up existing Spotify data even when Spotify is disabled", async () => {
    const userId = await fixture();
    vi.stubEnv("SPOTIFY_ENABLED", "false");

    await deleteApplicationAccount(userId);

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);
  });

  it("does not require valid Spotify configuration for account deletion", async () => {
    const userId = await fixture();
    vi.stubEnv("SPOTIFY_ENABLED", "true");
    vi.stubEnv("SPOTIFY_CLIENT_ID", "");
    vi.stubEnv("SPOTIFY_TOKEN_ENCRYPTION_KEYS", "invalid-test-configuration");

    await deleteApplicationAccount(userId);

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
  });

  it("rolls back Spotify cleanup when pending-transaction deletion fails", async () => {
    const userId = await fixture();
    vi.spyOn(SpotifyOAuthTransaction, "deleteMany").mockImplementationOnce(() => {
      throw new Error("test-only-transaction-cleanup-failure");
    });

    await expect(deleteApplicationAccount(userId))
      .rejects.toThrow("test-only-transaction-cleanup-failure");
    await expectPreserved(userId);
  });

  it("rolls back Spotify cleanup when Favorite deletion fails", async () => {
    const userId = await fixture();
    vi.spyOn(Favorite, "deleteMany").mockImplementationOnce(() => {
      throw new Error("test-only-favorite-cleanup-failure");
    });

    await expect(deleteApplicationAccount(userId))
      .rejects.toThrow("test-only-favorite-cleanup-failure");
    await expectPreserved(userId);
  });

  it("rolls back Spotify and Favorite cleanup when Playlist deletion fails", async () => {
    const userId = await fixture();
    vi.spyOn(Playlist, "deleteMany").mockImplementationOnce(() => {
      throw new Error("test-only-playlist-cleanup-failure");
    });

    await expect(deleteApplicationAccount(userId))
      .rejects.toThrow("test-only-playlist-cleanup-failure");
    await expectPreserved(userId);
  });

  it("rolls back every cleanup step when final User deletion fails", async () => {
    const userId = await fixture();
    vi.spyOn(User, "deleteOne").mockImplementationOnce(() => {
      throw new Error("test-only-user-deletion-failure");
    });

    await expect(deleteApplicationAccount(userId))
      .rejects.toThrow("test-only-user-deletion-failure");
    await expectPreserved(userId);
  });

  it("prevents an old callback result from recreating the deleted account link", async () => {
    const userId = await fixture();
    await deleteApplicationAccount(userId);

    await expect(persistSpotifyAccountLink({
      userId,
      generation: 0,
      authorization: authorization("owner"),
      config,
    })).rejects.toMatchObject({ code: "stale_spotify_generation" });

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
  });

  it("rejects an already missing User", async () => {
    await expect(deleteApplicationAccount(new Types.ObjectId().toString()))
      .rejects.toMatchObject({ code: "stale_spotify_generation" });
  });

  it("reconciles an existing User through fenced cleanup", async () => {
    const userId = await fixture();
    await cleanupAcceptedAccountDeletion(userId);

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
    await expect(Playlist.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);
  });

  it("cleans orphaned records repeatedly without recreating a missing User", async () => {
    const userId = await fixture();
    const otherId = await fixture("other");
    await User.deleteOne({ _id: userId });

    await cleanupAcceptedAccountDeletion(userId);
    await cleanupAcceptedAccountDeletion(userId);

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
    await expect(Playlist.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);
    await expectPreserved(otherId);
  });

  it("rolls back orphan cleanup when Playlist deletion fails", async () => {
    const userId = await fixture();
    await User.deleteOne({ _id: userId });
    vi.spyOn(Playlist, "deleteMany").mockImplementationOnce(() => {
      throw new Error("synthetic-orphan-cleanup-failure");
    });

    await expect(cleanupAcceptedAccountDeletion(userId))
      .rejects.toThrow("synthetic-orphan-cleanup-failure");

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(1);
    await expect(Playlist.countDocuments({ userId })).resolves.toBe(2);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(2);
  });

  it("does not bypass fencing for an existing User with invalid counters", async () => {
    const userId = await fixture();
    await User.collection.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $set: { spotifyLinkGeneration: -1 } },
    );
    const cleanup = vi.spyOn(Favorite, "deleteMany");

    await expect(cleanupAcceptedAccountDeletion(userId))
      .rejects.toMatchObject({ code: "stale_spotify_generation" });

    expect(cleanup).not.toHaveBeenCalled();
    await expect(User.findById(userId)).resolves.not.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(1);
    await expect(Playlist.countDocuments({ userId })).resolves.toBe(2);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(2);
  });

  it("rejects malformed reconciliation identifiers before cleanup", async () => {
    const cleanup = vi.spyOn(Favorite, "deleteMany");

    await expect(cleanupAcceptedAccountDeletion("invalid-user-id"))
      .rejects.toMatchObject({ code: "invalid_generation_context" });

    expect(cleanup).not.toHaveBeenCalled();
  });

});
