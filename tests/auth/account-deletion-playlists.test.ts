import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

import { DELETE } from "@/app/api/user/me/route";
import { generateToken } from "@/lib/jwt";
import Favorite from "@/models/Favorite";
import Playlist from "@/models/Playlist";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function request() {
  return new Request("http://127.0.0.1:3000/api/user/me", {
    method: "DELETE",
    headers: { Origin: "http://127.0.0.1:3001" },
  });
}

async function fixture() {
  const owner = await User.create({
    name: "Playlist Owner",
    email: "playlist-delete-owner@example.com",
    password: "test-only-password",
  });
  const other = await User.create({
    name: "Other Playlist Owner",
    email: "playlist-delete-other@example.com",
    password: "test-only-password",
  });

  const soundtrack = await Soundtrack.create({
    title: "Shared Test Track",
    movie: "Test Movie",
    composer: "Test Composer",
    moods: ["calm"],
  });

  await Playlist.create([
    {
      userId: owner._id,
      name: "Shared playlist name",
      soundtracks: [soundtrack._id],
    },
    {
      userId: owner._id,
      name: "Second owned playlist",
      soundtracks: [],
    },
    {
      userId: other._id,
      name: "Shared playlist name",
      description: "Preserve this playlist",
      soundtracks: [soundtrack._id],
    },
  ]);

  await Favorite.collection.insertMany([
    { userId: owner._id, soundtrackId: soundtrack._id },
    { userId: other._id, soundtrackId: soundtrack._id },
  ]);

  cookieGetMock.mockReturnValue({
    value: generateToken({
      id: owner._id.toString(),
      email: owner.email,
    }),
  });

  const originalTrack = await Soundtrack.collection.findOne({
    _id: soundtrack._id,
  });
  const originalOtherPlaylist = await Playlist.collection.findOne({
    userId: other._id,
  });

  return { owner, other, soundtrack, originalTrack, originalOtherPlaylist };
}

describe("Account deletion includes owned Playlists", () => {
  beforeAll(async () => {
    await User.init();
    await Favorite.init();
    await Playlist.init();
    await Soundtrack.init();
  });

  beforeEach(() => {
    cookieGetMock.mockReset();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden during account deletion"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("deletes owned Playlists while preserving another user's data and shared tracks", async () => {
    const data = await fixture();
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Account deleted successfully",
    });

    await expect(User.findById(data.owner._id)).resolves.toBeNull();
    await expect(Playlist.countDocuments({ userId: data.owner._id })).resolves.toBe(0);
    await expect(Favorite.countDocuments({ userId: data.owner._id })).resolves.toBe(0);

    await expect(User.findById(data.other._id)).resolves.not.toBeNull();
    await expect(Favorite.countDocuments({ userId: data.other._id })).resolves.toBe(1);
    expect(await Playlist.collection.findOne({ userId: data.other._id }))
      .toEqual(data.originalOtherPlaylist);

    await expect(Soundtrack.countDocuments()).resolves.toBe(1);
    expect(await Soundtrack.collection.findOne({ _id: data.soundtrack._id }))
      .toEqual(data.originalTrack);

    const auth = response.cookies.get("token");
    expect(auth?.value).toBe("");
    expect(auth?.path).toBe("/");
    expect(auth?.expires).toEqual(new Date(0));
    expect(response.cookies.get("spotify_oauth")?.value).toBe("");
    expect(response.cookies.get("spotify_oauth")?.path).toBe("/api/spotify");
  });

  it.each(["playlist", "user"])(
    "rolls back the entire deletion when %s cleanup fails",
    async failure => {
      const data = await fixture();

      if (failure === "playlist") {
        vi.spyOn(Playlist, "deleteMany").mockImplementationOnce(() => {
          throw new Error("test-only-private-playlist-failure");
        });
      } else {
        vi.spyOn(User, "deleteOne").mockImplementationOnce(() => {
          throw new Error("test-only-private-user-failure");
        });
      }

      const response = await DELETE(request());
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        message: "Internal server error",
      });
      expect(response.headers.has("set-cookie")).toBe(false);

      const owner = await User.findById(data.owner._id)
        .select("+spotifyLinkGeneration");
      expect(owner?.spotifyLinkGeneration).toBe(0);
      await expect(Playlist.countDocuments({ userId: data.owner._id })).resolves.toBe(2);
      await expect(Favorite.countDocuments({ userId: data.owner._id })).resolves.toBe(1);
      expect(await Playlist.collection.findOne({ userId: data.other._id }))
        .toEqual(data.originalOtherPlaylist);
      expect(await Soundtrack.collection.findOne({ _id: data.soundtrack._id }))
        .toEqual(data.originalTrack);
    },
  );
});
