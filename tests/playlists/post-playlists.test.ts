import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { POST } from "@/app/api/playlists/route";
import { generateToken } from "@/lib/jwt";
import Playlist from "@/models/Playlist";
import User from "@/models/User";

function createPlaylistRequest(body: unknown) {
  return new Request("http://localhost/api/playlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

describe("POST /api/playlists", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("creates and returns a trimmed playlist for the authenticated user", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await POST(
      createPlaylistRequest({
        name: "  Focus  ",
        description: "  Soundtracks for focused work  ",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      userId: user._id.toString(),
      name: "Focus",
      description: "Soundtracks for focused work",
      soundtracks: [],
    });
    expect(body).toHaveProperty("_id");

    const storedPlaylist = await Playlist.findById(body._id);

    expect(storedPlaylist).not.toBeNull();
    expect(storedPlaylist?.userId.toString()).toBe(user._id.toString());
    expect(storedPlaylist?.name).toBe("Focus");
    expect(storedPlaylist?.description).toBe("Soundtracks for focused work");
    expect(storedPlaylist?.soundtracks).toHaveLength(0);
  });

  it("defaults an omitted description to an empty string", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await POST(
      createPlaylistRequest({
        name: "Focus",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.description).toBe("");

    const storedPlaylist = await Playlist.findById(body._id);

    expect(storedPlaylist?.description).toBe("");
  });

  it("defaults a non-string description to an empty string", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await POST(
      createPlaylistRequest({
        name: "Focus",
        description: 123,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.description).toBe("");

    const storedPlaylist = await Playlist.findById(body._id);

    expect(storedPlaylist?.description).toBe("");
  });

  it.each([
    ["missing", {}],
    ["non-string", { name: 123 }],
    ["empty", { name: "" }],
    ["whitespace-only", { name: "   " }],
  ])("rejects a %s playlist name", async (_case, requestBody) => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await POST(createPlaylistRequest(requestBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist name is required",
    });
    await expect(
      Playlist.countDocuments({
        userId: user._id,
      }),
    ).resolves.toBe(0);
  });

  it("rejects a duplicate playlist name for the same user", async () => {
    const user = await createUser("Test User", "test@example.com");

    await Playlist.create({
      userId: user._id,
      name: "Focus",
    });

    authenticateUser(user);

    const response = await POST(
      createPlaylistRequest({
        name: "  Focus  ",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "Playlist already exists",
    });
    await expect(
      Playlist.countDocuments({
        userId: user._id,
        name: "Focus",
      }),
    ).resolves.toBe(1);
  });

  it("allows different users to use the same playlist name", async () => {
    const firstUser = await createUser("First User", "first@example.com");
    const secondUser = await createUser("Second User", "second@example.com");

    authenticateUser(firstUser);
    const firstResponse = await POST(
      createPlaylistRequest({
        name: "Focus",
      }),
    );

    authenticateUser(secondUser);
    const secondResponse = await POST(
      createPlaylistRequest({
        name: "Focus",
      }),
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    await expect(
      Playlist.countDocuments({
        name: "Focus",
      }),
    ).resolves.toBe(2);
  });

  it("preserves the internal server error response for a name longer than 100 characters", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await POST(
      createPlaylistRequest({
        name: "a".repeat(101),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
    await expect(
      Playlist.countDocuments({
        userId: user._id,
      }),
    ).resolves.toBe(0);
  });

  it("preserves the internal server error response for a description longer than 500 characters", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await POST(
      createPlaylistRequest({
        name: "Focus",
        description: "a".repeat(501),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
    await expect(
      Playlist.countDocuments({
        userId: user._id,
      }),
    ).resolves.toBe(0);
  });

  it("rejects a missing authentication token", async () => {
    const response = await POST(
      createPlaylistRequest({
        name: "Focus",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
    await expect(Playlist.countDocuments()).resolves.toBe(0);
  });

  it("preserves the internal server error response for an invalid authentication token", async () => {
    cookieGetMock.mockReturnValue({
      name: "token",
      value: "invalid-token",
    });

    const response = await POST(
      createPlaylistRequest({
        name: "Focus",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
    await expect(Playlist.countDocuments()).resolves.toBe(0);
  });
});
