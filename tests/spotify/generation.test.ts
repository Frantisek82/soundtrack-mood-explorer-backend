import { type ClientSession } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  invalidateSpotifyLinkGeneration,
  SpotifyGenerationError,
  withSpotifyLinkGeneration,
} from "@/lib/spotify/generation";
import User from "@/models/User";
import SpotifyConnection from "@/models/SpotifyConnection";

async function createUser() {
  return User.create({
    name: "Generation Coordination User",
    email: "coordination@example.com",
    password: "test-only-password",
  });
}

async function createConnection(
  userId: string,
  generation: number,
  session: ClientSession,
) {
  await SpotifyConnection.create(
    [
      {
        userId,
        accountId: "test-account",
        status: "reauthorization_required",
        generation,
        originalAuthorizedAt: new Date(),
        estimatedRefreshExpiry: new Date(Date.now() + 600_000),
      },
    ],
    { session, ordered: true },
  );
}

async function generationOf(userId: string) {
  const user = await User.findById(userId).select("+spotifyLinkGeneration");
  return user?.spotifyLinkGeneration;
}

describe("Spotify generation coordination", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  it("allows persistence at the current generation", async () => {
    const user = await createUser();
    const userId = user._id.toString();

    await withSpotifyLinkGeneration(userId, 0, async (session) => {
      await createConnection(userId, 0, session);
    });

    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);

    const internal = await User.findById(userId)
      .select("+spotifyLinkWriteVersion")
      .lean();
    expect(internal).toHaveProperty("spotifyLinkWriteVersion", 1);

    const ordinary = await User.findById(userId).lean();
    expect(ordinary).not.toHaveProperty("spotifyLinkWriteVersion");
  });

  it("coordinates legacy users whose counters are absent", async () => {
    const user = await createUser();
    await User.collection.updateOne(
      { _id: user._id },
      {
        $unset: {
          spotifyLinkGeneration: "",
          spotifyLinkWriteVersion: "",
        },
      },
    );

    await withSpotifyLinkGeneration(
      user._id.toString(),
      0,
      async () => undefined,
    );

    await expect(generationOf(user._id.toString())).resolves.toBe(0);
  });

  it("rejects stale persistence after disconnect invalidation", async () => {
    const user = await createUser();
    const userId = user._id.toString();

    await withSpotifyLinkGeneration(userId, 0, async (session) => {
      await createConnection(userId, 0, session);
    });

    await invalidateSpotifyLinkGeneration(userId, async (session) => {
      await SpotifyConnection.deleteMany({ userId }, { session });
    });

    await expect(
      withSpotifyLinkGeneration(userId, 0, async (session) => {
        await createConnection(userId, 0, session);
      }),
    ).rejects.toMatchObject({ code: "stale_spotify_generation" });

    await expect(generationOf(userId)).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
  });

  it("allows a new connection at the new generation", async () => {
    const user = await createUser();
    const userId = user._id.toString();

    const invalidated = await invalidateSpotifyLinkGeneration(
      userId,
      async () => undefined,
    );

    await withSpotifyLinkGeneration(
      userId,
      invalidated.generation,
      async (session) => {
        await createConnection(userId, invalidated.generation, session);
      },
    );

    const connection = await SpotifyConnection.findOne({ userId }).lean();
    expect(connection?.generation).toBe(1);
  });

  it("rolls back generation and cleanup together on failure", async () => {
    const user = await createUser();
    const userId = user._id.toString();

    await withSpotifyLinkGeneration(userId, 0, async (session) => {
      await createConnection(userId, 0, session);
    });

    await expect(
      invalidateSpotifyLinkGeneration(userId, async (session) => {
        await SpotifyConnection.deleteMany({ userId }, { session });
        throw new Error("Intentional cleanup failure");
      }),
    ).rejects.toThrow("Intentional cleanup failure");

    await expect(generationOf(userId)).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
  });

  it("rejects persistence after coordinated User deletion", async () => {
    const user = await createUser();
    const userId = user._id.toString();

    await invalidateSpotifyLinkGeneration(userId, async (session) => {
      await SpotifyConnection.deleteMany({ userId }, { session });
      await User.deleteOne({ _id: user._id }, { session });
    });

    await expect(
      withSpotifyLinkGeneration(userId, 0, async (session) => {
        await createConnection(userId, 0, session);
      }),
    ).rejects.toMatchObject({ code: "stale_spotify_generation" });

    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
  });

  it("serializes concurrent invalidations without losing increments", async () => {
    const user = await createUser();
    const userId = user._id.toString();

    // Separate transactions/sessions; no parallel operations within a session.
    const results = await Promise.all([
      invalidateSpotifyLinkGeneration(userId, async () => undefined),
      invalidateSpotifyLinkGeneration(userId, async () => undefined),
    ]);

    expect(results.map((result) => result.generation).sort()).toEqual([1, 2]);
    await expect(generationOf(userId)).resolves.toBe(2);
  });

  it("cannot leave an old connection after competing persistence and invalidation", async () => {
    const user = await createUser();
    const userId = user._id.toString();

    const [persistence, invalidation] = await Promise.allSettled([
      withSpotifyLinkGeneration(userId, 0, async (session) => {
        await createConnection(userId, 0, session);
      }),
      invalidateSpotifyLinkGeneration(userId, async (session) => {
        await SpotifyConnection.deleteMany({ userId }, { session });
      }),
    ]);

    expect(invalidation.status).toBe("fulfilled");
    if (persistence.status === "rejected") {
      expect(persistence.reason).toBeInstanceOf(SpotifyGenerationError);
      expect(persistence.reason.code).toBe("stale_spotify_generation");
    }

    await expect(generationOf(userId)).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
  });

  it("rejects counter overflow without running cleanup", async () => {
    const user = await createUser();
    await User.collection.updateOne(
      { _id: user._id },
      { $set: { spotifyLinkGeneration: Number.MAX_SAFE_INTEGER } },
    );

    await expect(
      invalidateSpotifyLinkGeneration(user._id.toString(), async () => {
        throw new Error("Cleanup must not run");
      }),
    ).rejects.toMatchObject({ code: "stale_spotify_generation" });
  });
});
