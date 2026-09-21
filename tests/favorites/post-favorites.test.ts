import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { POST } from "@/app/api/favorites/route";
import { generateToken } from "@/lib/jwt";
import Favorite from "@/models/Favorite";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createFavoriteRequest(soundtrackId: string) {
  return new Request("http://localhost/api/favorites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ soundtrackId }),
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

async function createSoundtrack() {
  return Soundtrack.create({
    title: "Time",
    movie: "Inception",
    composer: "Hans Zimmer",
  });
}

describe("POST /api/favorites", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("creates and returns a favorite for the authenticated user", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    authenticateUser(user);

    const response = await POST(
      createFavoriteRequest(soundtrack._id.toString()),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      userId: user._id.toString(),
      soundtrackId: soundtrack._id.toString(),
    });
    expect(body).toHaveProperty("_id");

    const storedFavorite = await Favorite.findById(body._id);

    expect(storedFavorite).not.toBeNull();
    expect(storedFavorite.userId.toString()).toBe(user._id.toString());
    expect(storedFavorite.soundtrackId.toString()).toBe(
      soundtrack._id.toString(),
    );
  });

  it("rejects a duplicate favorite", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();

    await Favorite.create({
      userId: user._id,
      soundtrackId: soundtrack._id,
    });

    authenticateUser(user);

    const response = await POST(
      createFavoriteRequest(soundtrack._id.toString()),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "Already in favorites",
    });
    await expect(
      Favorite.countDocuments({
        userId: user._id,
        soundtrackId: soundtrack._id,
      }),
    ).resolves.toBe(1);
  });

  it("allows different users to favorite the same soundtrack", async () => {
    const firstUser = await createUser("First User", "first@example.com");
    const secondUser = await createUser("Second User", "second@example.com");
    const soundtrack = await createSoundtrack();

    authenticateUser(firstUser);
    const firstResponse = await POST(
      createFavoriteRequest(soundtrack._id.toString()),
    );

    authenticateUser(secondUser);
    const secondResponse = await POST(
      createFavoriteRequest(soundtrack._id.toString()),
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    await expect(
      Favorite.countDocuments({
        soundtrackId: soundtrack._id,
      }),
    ).resolves.toBe(2);
  });

  it("rejects a missing authentication token", async () => {
    const response = await POST(
      createFavoriteRequest(new Soundtrack()._id.toString()),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("rejects an invalid authentication token", async () => {
    cookieGetMock.mockReturnValue({
      name: "token",
      value: "invalid-token",
    });

    const response = await POST(
      createFavoriteRequest(new Soundtrack()._id.toString()),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("preserves the unauthorized response for a malformed soundtrack ID", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await POST(createFavoriteRequest("not-an-object-id"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });
});
