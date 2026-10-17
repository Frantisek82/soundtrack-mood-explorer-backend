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
import { requireSpotifyReauthorization } from "@/lib/spotify/reauthorization";
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

async function fixture() {
  const user = await User.create({
    name: "Reauthorization User",
    email: "reauthorization@example.com",
    password: "test-only-password",
  });

  const userId = user._id.toString();
  const authorization = {
    accountId: "test-only-reauthorization-account",
    displayName: "Test Listener",
    accessToken: "test-only-access",
    refreshToken: "test-only-refresh",
    grantedScopes: [],
    authorizedAt: new Date(instant.getTime() - 3_600_000),
    accessExpiresAt: new Date(instant.getTime() + 3_600_000),
  };

  await persistSpotifyAccountLink({
    userId, generation: 0, authorization, config,
  });

  return {
    input: { userId, generation: 0, tokenVersion: 0 },
    authorization,
  };
}

describe("Version-fenced Spotify reauthorization", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden in database coordination"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("discards credentials but preserves linking identity and lifetime metadata", async () => {
    const { input } = await fixture();
    const before = await SpotifyConnection.collection.findOne({});

    await expect(requireSpotifyReauthorization(input)).resolves.toBe(true);

    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.status).toBe("reauthorization_required");
    expect(stored?.tokenVersion).toBe(1);
    expect(stored?.accessToken).toBeUndefined();
    expect(stored?.refreshToken).toBeUndefined();
    expect(stored?.accessExpiresAt).toBeUndefined();
    expect(stored?.accountId).toBe(before?.accountId);
    expect(stored?.displayName).toBe(before?.displayName);
    expect(stored?.originalAuthorizedAt).toEqual(before?.originalAuthorizedAt);
    expect(stored?.estimatedRefreshExpiry).toEqual(before?.estimatedRefreshExpiry);
  });

  it("does not apply the same invalidation twice", async () => {
    const { input } = await fixture();
    await expect(requireSpotifyReauthorization(input)).resolves.toBe(true);
    await expect(requireSpotifyReauthorization(input)).resolves.toBe(false);
    expect((await SpotifyConnection.collection.findOne({}))?.tokenVersion).toBe(1);
  });

  it("preserves a newer same-account reauthorization", async () => {
    const { input, authorization } = await fixture();

    await persistSpotifyAccountLink({
      userId: input.userId,
      generation: 0,
      config,
      authorization: {
        ...authorization,
        accessToken: "test-only-newer-access",
      },
    });
    const before = await SpotifyConnection.collection.findOne({});

    await expect(requireSpotifyReauthorization(input)).resolves.toBe(false);
    expect(await SpotifyConnection.collection.findOne({})).toEqual(before);
  });

  it("does not invalidate a token version currently owned by a refresh lease", async () => {
    const { input } = await fixture();
    const acquired = await acquireSpotifyRefreshLease({
      ...input, now: () => new Date(instant),
    });
    expect(acquired.state).toBe("acquired");
    const before = await SpotifyConnection.collection.findOne({});

    await expect(requireSpotifyReauthorization(input)).resolves.toBe(false);
    expect(await SpotifyConnection.collection.findOne({})).toEqual(before);
  });

  it("never upserts a missing connection", async () => {
    const { input } = await fixture();
    await SpotifyConnection.deleteMany({});

    await expect(requireSpotifyReauthorization(input)).resolves.toBe(false);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it.each(["disconnect", "delete"])(
    "cannot restore data after %s",
    async action => {
      const { input } = await fixture();

      await invalidateSpotifyLinkGeneration(input.userId, async session => {
        await SpotifyConnection.deleteMany({ userId: input.userId }).session(session);
        if (action === "delete") {
          await User.deleteOne({ _id: input.userId }).session(session);
        }
      });

      await expect(requireSpotifyReauthorization(input)).rejects.toMatchObject({
        code: "stale_spotify_generation",
      });
      await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid token version %s",
    async tokenVersion => {
      const { input } = await fixture();
      await expect(requireSpotifyReauthorization({
        ...input, tokenVersion,
      })).rejects.toThrow("Invalid Spotify token version");
    },
  );
});
