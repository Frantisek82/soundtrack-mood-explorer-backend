import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { PATCH } from "@/app/api/playlists/[id]/route";
import { generateToken } from "@/lib/jwt";
import Playlist from "@/models/Playlist";
import User from "@/models/User";

function createPatchPlaylistRequest(playlistId: string, body: unknown) {
  return new Request(`http://localhost/api/playlists/${playlistId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

describe("PATCH /api/playlists/:id", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("updates and returns the authenticated owner's trimmed playlist values", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Original",
      description: "Original description",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "  Updated  ",
        description: "  Updated description  ",
      }),
      createRouteContext(playlistId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      _id: playlistId,
      userId: user._id.toString(),
      name: "Updated",
      description: "Updated description",
      soundtracks: [],
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.name).toBe("Updated");
    expect(storedPlaylist?.description).toBe("Updated description");
  });

  it("sets an omitted description to an empty string", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Original",
      description: "Original description",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Updated",
      }),
      createRouteContext(playlistId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.description).toBe("");

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.description).toBe("");
  });

  it("sets a non-string description to an empty string", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Original",
      description: "Original description",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Updated",
        description: 123,
      }),
      createRouteContext(playlistId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.description).toBe("");

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.description).toBe("");
  });

  it.each([
    ["missing", {}],
    ["non-string", { name: 123 }],
    ["empty", { name: "" }],
    ["whitespace-only", { name: "   " }],
  ])("rejects a %s playlist name", async (_case, requestBody) => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Original",
      description: "Original description",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, requestBody),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist name is required",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.name).toBe("Original");
    expect(storedPlaylist?.description).toBe("Original description");
  });

  it("rejects a malformed playlist ID", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const playlistId = "not-an-object-id";
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Updated",
      }),
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
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Updated",
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });
  });

  it("does not update another user's playlist", async () => {
    const authenticatedUser = await createUser(
      "Authenticated User",
      "authenticated@example.com",
    );
    const otherUser = await createUser("Other User", "other@example.com");
    const otherPlaylist = await Playlist.create({
      userId: otherUser._id,
      name: "Private Playlist",
      description: "Private description",
    });

    authenticateUser(authenticatedUser);

    const playlistId = otherPlaylist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Changed",
        description: "Changed description",
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist not found",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.name).toBe("Private Playlist");
    expect(storedPlaylist?.description).toBe("Private description");
  });

  it("rejects a duplicate playlist name for the same user", async () => {
    const user = await createUser("Test User", "test@example.com");
    await Playlist.create({
      userId: user._id,
      name: "Existing",
    });
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Original",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "  Existing  ",
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist already exists",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.name).toBe("Original");
  });

  it("allows different users to use the same playlist name", async () => {
    const firstUser = await createUser("First User", "first@example.com");
    const secondUser = await createUser("Second User", "second@example.com");
    const firstPlaylist = await Playlist.create({
      userId: firstUser._id,
      name: "Original",
    });
    await Playlist.create({
      userId: secondUser._id,
      name: "Shared",
    });

    authenticateUser(firstUser);

    const playlistId = firstPlaylist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Shared",
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(200);

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.name).toBe("Shared");
    await expect(
      Playlist.countDocuments({
        name: "Shared",
      }),
    ).resolves.toBe(2);
  });

  it("preserves the internal server error response for a name longer than 100 characters", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Original",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "a".repeat(101),
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.name).toBe("Original");
  });

  it("preserves the internal server error response for a description longer than 500 characters", async () => {
    const user = await createUser("Test User", "test@example.com");
    const playlist = await Playlist.create({
      userId: user._id,
      name: "Original",
      description: "Original description",
    });

    authenticateUser(user);

    const playlistId = playlist._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Updated",
        description: "a".repeat(501),
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });

    const storedPlaylist = await Playlist.findById(playlistId);

    expect(storedPlaylist?.name).toBe("Original");
    expect(storedPlaylist?.description).toBe("Original description");
  });

  it("rejects a missing authentication token", async () => {
    const playlistId = new Playlist()._id.toString();
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Updated",
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
    const response = await PATCH(
      createPatchPlaylistRequest(playlistId, {
        name: "Updated",
      }),
      createRouteContext(playlistId),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
  });
});
