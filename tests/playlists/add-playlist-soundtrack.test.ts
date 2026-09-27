import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { POST } from "@/app/api/playlists/[id]/soundtracks/route";
import { generateToken } from "@/lib/jwt";
import Playlist from "@/models/Playlist";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createAddSoundtrackRequest(playlistId: string, body: unknown) {
  return new Request(
    `http://localhost/api/playlists/${playlistId}/soundtracks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
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

describe("POST /api/playlists/:id/soundtracks", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("adds a soundtrack to the authenticated owner's playlist", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const soundtrackId = soundtrack._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId,
      }),
      createRouteContext(playlistId),
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
      _id: soundtrackId,
      title: "Time",
      movie: "Inception",
      composer: "Hans Zimmer",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks.map(String)).toEqual([soundtrackId]);
  });

  it("rejects a duplicate soundtrack addition", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
      soundtracks: [soundtrack._id],
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const soundtrackId = soundtrack._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId,
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "Soundtrack already exists in playlist",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks.map(String)).toEqual([soundtrackId]);
  });

  it("returns not found for a malformed playlist ID", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    authenticateUser(user);

    const playlistId = "not-an-object-id";
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId: soundtrack._id.toString(),
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });
  });

  it("returns not found for a missing playlist", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    authenticateUser(user);

    const playlistId = new Playlist()._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId: soundtrack._id.toString(),
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });
  });

  it.each([
    ["missing", {}],
    ["non-string", { soundtrackId: 123 }],
    ["malformed", { soundtrackId: "not-an-object-id" }],
  ])("returns not found for a %s soundtrack ID", async (_case, requestBody) => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, requestBody),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Soundtrack not found",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks).toHaveLength(0);
  });

  it("returns not found for a nonexistent soundtrack", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Focus",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId,
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Soundtrack not found",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks).toHaveLength(0);
  });

  it("does not add a soundtrack to another user's playlist", async () => {
    const authenticatedUser = await createUser(
      "Authenticated User",
      "authenticated@example.com",
    );
    const otherUser = await createUser("Other User", "other@example.com");
    const soundtrack = await createSoundtrack();
    const otherPlaylist = await Playlist.create({
      userId: otherUser._id,
      name: "Private Playlist",
    });

    authenticateUser(authenticatedUser);

    const playlistId = otherPlaylist._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId: soundtrack._id.toString(),
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.soundtracks).toHaveLength(0);
  });

  it("rejects a missing authentication token", async () => {
    const playlistId = new Playlist()._id.toString();
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId,
      }),
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
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await POST(
      createAddSoundtrackRequest(playlistId, {
        soundtrackId,
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
  });
});
