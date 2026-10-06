import { describe, expect, it, vi } from "vitest";
import { soundtrackCatalogue } from "@/data/soundtrack-catalogue";
import { POST } from "@/app/api/seed/route";
import * as database from "@/lib/db";
import Favorite from "@/models/Favorite";
import Playlist from "@/models/Playlist";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

const catalogue = [
  {
    title: "Time",
    movie: "Inception",
    composer: "Hans Zimmer",
    moods: ["Epic", "Emotional"],
    spotifyTrackId: "6ZFbXIJkuI1dVNWvzJzown",
  },
  {
    title: "Cornfield Chase",
    movie: "Interstellar",
    composer: "Hans Zimmer",
    moods: ["Calm"],
    spotifyTrackId: "6pWgRkpqVfxnj3WuIcJ7WP",
  },
];

describe("POST /api/seed", () => {
  it("contains 100 unique tracks and preserves the original seed fields", () => {
    expect(soundtrackCatalogue).toHaveLength(100);
    expect(soundtrackCatalogue.slice(0, 2)).toEqual(catalogue);

    expect(
      new Set(soundtrackCatalogue.map((entry) => entry.spotifyTrackId)).size,
    ).toBe(100);

    expect(
      new Set(
        soundtrackCatalogue.map((entry) =>
          JSON.stringify([entry.title, entry.movie, entry.composer]),
        ),
      ).size,
    ).toBe(100);
  });

  it("rejects production requests before connecting to the database", async () => {
    const existing = await Soundtrack.create(catalogue[0]);
    const connectSpy = vi.spyOn(database, "connectDB");

    let response: Awaited<ReturnType<typeof POST>>;

    vi.stubEnv("NODE_ENV", "production");
    try {
      response = await POST();
      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      connectSpy.mockRestore();
    }

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Forbidden",
    });
    await expect(Soundtrack.countDocuments()).resolves.toBe(1);
    await expect(Soundtrack.findById(existing._id).lean()).resolves.toEqual(
      existing.toObject(),
    );
  });

  it("inserts the existing catalogue and preserves the success response", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Database seeded",
    });

    const stored = await Soundtrack.find().lean();

    expect(stored).toHaveLength(100);
    expect(stored).toEqual(
      expect.arrayContaining(
        soundtrackCatalogue.map((entry) => expect.objectContaining(entry)),
      ),
    );
  });

  it("preserves records, IDs, and timestamps when seeding again", async () => {
    await POST();
    const before = await Soundtrack.find().sort({ title: 1 }).lean();

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Database seeded",
    });
    await expect(Soundtrack.find().sort({ title: 1 }).lean()).resolves.toEqual(
      before,
    );
  });

  it("preserves unrelated soundtracks and all their field values", async () => {
    const existing = await Soundtrack.create({
      title: "Test Soundtrack",
      movie: "Test Movie",
      composer: "Test Composer",
      moods: ["Custom Mood"],
      spotifyTrackId: "existing-track-id",
    });

    await POST();

    await expect(Soundtrack.countDocuments()).resolves.toBe(101);
    await expect(Soundtrack.findById(existing._id).lean()).resolves.toEqual(
      existing.toObject(),
    );
  });

  it.each([
    ["matching Spotify ID", catalogue[0].spotifyTrackId],
    ["missing Spotify ID", null],
    ["different Spotify ID", "preserved-track-id"],
  ])(
    "adds only the missing catalogue entry with an existing %s",
    async (_description, spotifyTrackId) => {
      const existing = await Soundtrack.create({
        ...catalogue[0],
        moods: ["Preserved Mood"],
        spotifyTrackId,
      });

      await POST();
      await POST();

      await expect(Soundtrack.countDocuments()).resolves.toBe(100);
      await expect(Soundtrack.findById(existing._id).lean()).resolves.toEqual(
        existing.toObject(),
      );
      await expect(
        Soundtrack.findOne({
          title: catalogue[1].title,
          movie: catalogue[1].movie,
          composer: catalogue[1].composer,
        }).lean(),
      ).resolves.toMatchObject(catalogue[1]);
    },
  );

  it("preserves favorite and playlist references to existing soundtracks", async () => {
    const user = await User.create({
      name: "Seed Test User",
      email: "seed-test@example.com",
      password: "stored-password",
    });
    const seeded = await Soundtrack.create(catalogue[0]);
    const unrelated = await Soundtrack.create({
      title: "Referenced Soundtrack",
      movie: "Referenced Movie",
      composer: "Referenced Composer",
    });
    const favorites = await Favorite.create([
      { userId: user._id, soundtrackId: seeded._id },
      { userId: user._id, soundtrackId: unrelated._id },
    ]);
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Seed Test Playlist",
      soundtracks: [seeded._id, unrelated._id],
    });

    await POST();
    await POST();

    await expect(Favorite.countDocuments()).resolves.toBe(2);
    await expect(Playlist.countDocuments()).resolves.toBe(1);

    for (const favorite of favorites) {
      const stored = await Favorite.findById(favorite._id);
      expect(stored.toObject()).toEqual(favorite.toObject());

      const populated = await Favorite.findById(favorite._id).populate(
        "soundtrackId",
      );
      expect(populated.soundtrackId).not.toBeNull();
      expect(populated.soundtrackId._id.toString()).toBe(
        favorite.soundtrackId.toString(),
      );
    }

    const storedPlaylist = await Playlist.findById(playlist._id);
    expect(storedPlaylist.toObject()).toEqual(playlist.toObject());

    const populatedPlaylist = await Playlist.findById(playlist._id).populate(
      "soundtracks",
    );
    expect(
      populatedPlaylist.soundtracks.map(
        (soundtrack: { _id: { toString(): string } }) =>
          soundtrack._id.toString(),
      ),
    ).toEqual([seeded._id.toString(), unrelated._id.toString()]);
  });
});
