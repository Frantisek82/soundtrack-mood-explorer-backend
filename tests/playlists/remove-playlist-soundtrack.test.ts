import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { DELETE } from "@/app/api/playlists/[id]/soundtracks/[soundtrackId]/route";
import { generateToken } from "@/lib/jwt";
import Playlist from "@/models/Playlist";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createRemoveSoundtrackRequest(
  playlistId: string,
  soundtrackId: string,
) {
  return new Request(
    `http://localhost/api/playlists/${playlistId}/soundtracks/${soundtrackId}`,
    {
      method: "DELETE",
    },
  );
}

function createRouteContext(playlistId: string, soundtrackId: string) {
  return {
    params: Promise.resolve({
      id: playlistId,
      soundtrackId,
    }),
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

async function createSoundtrack(
  title: string,
  movie: string,
  composer: string,
) {
  return Soundtrack.create({
    title,
    movie,
    composer,
  });
}

describe("DELETE /api/playlists/:id/soundtracks/:soundtrackId", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("removes a soundtrack and returns the populated remaining soundtracks", async () => {
    const user = await createUser("Test User", "test@example.com");
    const removedSoundtrack = await createSoundtrack(
      "Time",
      "Inception",
      "Hans Zimmer",
    );
    const remainingSoundtrack = await createSoundtrack(
      "Cornfield Chase",
      "Interstellar",
      "Hans Zimmer",
    );
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
      soundtracks: [removedSoundtrack._id, remainingSoundtrack._id],
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const soundtrackId = removedSoundtrack._id.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      _id: playlistId,
      userId: user._id.toString(),
      name: "Focus",
    });
    expect(body.soundtracks).toHaveLength(1);
    expect(body.soundtracks[0]).toMatchObject({
      _id: remainingSoundtrack._id.toString(),
      title: "Cornfield Chase",
      movie: "Interstellar",
      composer: "Hans Zimmer",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks.map(String)).toEqual([
      remainingSoundtrack._id.toString(),
    ]);
  });

  it("removes a stored reference when the soundtrack document no longer exists", async () => {
    const user = await createUser("Test User", "test@example.com");
    const missingSoundtrackId = new Soundtrack()._id;
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
      soundtracks: [missingSoundtrackId],
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const soundtrackId = missingSoundtrackId.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.soundtracks).toEqual([]);

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks).toHaveLength(0);
  });

  it("returns not found for a malformed playlist ID", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const playlistId = "not-an-object-id";
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });
  });

  it("returns not found for a missing playlist", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const playlistId = new Playlist()._id.toString();
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });
  });

  it("returns not found for a malformed soundtrack ID", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const soundtrackId = "not-an-object-id";
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Soundtrack not found",
    });
  });

  it("returns not found when the soundtrack is not in the playlist", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Soundtrack not found in playlist",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks).toHaveLength(0);
  });

  it("does not remove a soundtrack from another user's playlist", async () => {
    const authenticatedUser = await createUser(
      "Authenticated User",
      "authenticated@example.com",
    );
    const otherUser = await createUser("Other User", "other@example.com");
    const soundtrack = await createSoundtrack(
      "Time",
      "Inception",
      "Hans Zimmer",
    );
    const otherPlaylist = await Playlist.create({
      userId: otherUser._id,
      name: "Private Playlist",
      soundtracks: [soundtrack._id],
    });

    authenticateUser(authenticatedUser);

    const playlistId = otherPlaylist._id.toString();
    const soundtrackId = soundtrack._id.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks.map(String)).toEqual([soundtrackId]);
  });

  it("rejects a missing authentication token", async () => {
    const playlistId = new Playlist()._id.toString();
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
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
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await DELETE(
      createRemoveSoundtrackRequest(playlistId, soundtrackId),
      createRouteContext(playlistId, soundtrackId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
  });
});
