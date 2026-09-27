import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { GET } from "@/app/api/playlists/[id]/route";
import { generateToken } from "@/lib/jwt";
import Playlist from "@/models/Playlist";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createPlaylistRequest(playlistId: string) {
  return new Request(`http://localhost/api/playlists/${playlistId}`, {
    method: "GET",
  });
}

function createRouteContext(playlistId: string) {
  return {
    params: Promise.resolve({ id: playlistId }),
  };
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

async function createSoundtrack() {
  return Soundtrack.create({
    title: "Time",
    movie: "Inception",
    composer: "Hans Zimmer",
  });
}

describe("GET /api/playlists/:id", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("returns the authenticated owner's playlist with populated soundtracks", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
      description: "Soundtracks for focused work",
      soundtracks: [soundtrack._id],
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await GET(
      createPlaylistRequest(playlistId),
      createRouteContext(playlistId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      _id: playlistId,
      userId: user._id.toString(),
      name: "Focus",
      description: "Soundtracks for focused work",
    });
    expect(body.soundtracks).toHaveLength(1);
    expect(body.soundtracks[0]).toMatchObject({
      _id: soundtrack._id.toString(),
      title: "Time",
      movie: "Inception",
      composer: "Hans Zimmer",
    });
  });

  it("rejects a malformed playlist ID", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const playlistId = "not-an-object-id";
    const response = await GET(
      createPlaylistRequest(playlistId),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid playlist ID",
    });
  });

  it("returns not found for a missing playlist", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const playlistId = new Playlist()._id.toString();
    const response = await GET(
      createPlaylistRequest(playlistId),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });
  });

  it("does not expose another user's playlist", async () => {
    const authenticatedUser = await createUser(
      "Authenticated User",
      "authenticated@example.com",
    );
    const otherUser = await createUser("Other User", "other@example.com");
    const otherPlaylist = await Playlist.create({
      userId: otherUser._id,
      name: "Private Playlist",
    });

    authenticateUser(authenticatedUser);

    const playlistId = otherPlaylist._id.toString();
    const response = await GET(
      createPlaylistRequest(playlistId),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });
  });

  it("rejects a missing authentication token", async () => {
    const playlistId = new Playlist()._id.toString();
    const response = await GET(
      createPlaylistRequest(playlistId),
      createRouteContext(playlistId),
    );

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

    const playlistId = new Playlist()._id.toString();
    const response = await GET(
      createPlaylistRequest(playlistId),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
  });
});
