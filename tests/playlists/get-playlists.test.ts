import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { GET } from "@/app/api/playlists/route";
import { generateToken } from "@/lib/jwt";
import Playlist from "@/models/Playlist";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createPlaylistsRequest() {
  return new Request("http://localhost/api/playlists", {
    method: "GET",
  });
}

function authenticateUser(user: {
  _id: { toString(): string };
  email: string;
}) {
  cookieGetMock.mockReturnValue({
    name: "token",
    value: generateToken({
      id: user._id.toString(),
      email: user.email,
    }),
  });
}

async function createUser(name: string, email: string) {
  return User.create({
    name,
    email,
    password: "stored-password",
  });
}

describe("GET /api/playlists", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("returns an empty array when the authenticated user has no playlists", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await GET(createPlaylistsRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("returns the authenticated user's playlists with stored soundtrack references", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await Soundtrack.create({
      title: "Time",
      movie: "Inception",
      composer: "Hans Zimmer",
    });
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
      description: "Soundtracks for focused work",
      soundtracks: [soundtrack._id],
    });

    authenticateUser(user);

    const response = await GET(createPlaylistsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      _id: playlist._id.toString(),
      userId: user._id.toString(),
      name: "Focus",
      description: "Soundtracks for focused work",
      soundtracks: [soundtrack._id.toString()],
    });
  });

  it("returns only the authenticated user's playlists in newest-first order", async () => {
    const authenticatedUser = await createUser(
      "Authenticated User",
      "authenticated@example.com",
    );
    const otherUser = await createUser("Other User", "other@example.com");

    const olderPlaylist = await Playlist.create({
      userId: authenticatedUser._id,
      name: "Older Playlist",
    });
    const newerPlaylist = await Playlist.create({
      userId: authenticatedUser._id,
      name: "Newer Playlist",
    });
    const otherPlaylist = await Playlist.create({
      userId: otherUser._id,
      name: "Other User Playlist",
    });

    await Playlist.collection.updateOne(
      { _id: olderPlaylist._id },
      { $set: { createdAt: new Date("2026-01-01T00:00:00.000Z") } },
    );
    await Playlist.collection.updateOne(
      { _id: newerPlaylist._id },
      { $set: { createdAt: new Date("2026-01-02T00:00:00.000Z") } },
    );

    authenticateUser(authenticatedUser);

    const response = await GET(createPlaylistsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.map((playlist: { _id: string }) => playlist._id)).toEqual([
      newerPlaylist._id.toString(),
      olderPlaylist._id.toString(),
    ]);
    expect(
      body.some(
        (playlist: { _id: string }) =>
          playlist._id === otherPlaylist._id.toString(),
      ),
    ).toBe(false);
  });

  it("rejects a missing authentication token", async () => {
    const response = await GET(createPlaylistsRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("preserves the internal server error response for an invalid authentication token", async () => {
    cookieGetMock.mockReturnValue({
      name: "token",
      value: "invalid-token",
    });

    const response = await GET(createPlaylistsRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
  });
});
