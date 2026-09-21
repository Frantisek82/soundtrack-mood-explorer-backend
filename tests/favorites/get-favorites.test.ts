import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { GET } from "@/app/api/favorites/route";
import { generateToken } from "@/lib/jwt";
import Favorite from "@/models/Favorite";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createFavoritesRequest() {
  return new Request("http://localhost/api/favorites", {
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

describe("GET /api/favorites", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("returns an empty array when the authenticated user has no favorites", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const response = await GET(createFavoritesRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("returns populated soundtrack documents without Favorite persistence fields", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack(
      "Time",
      "Inception",
      "Hans Zimmer",
    );

    await Favorite.create({
      userId: user._id,
      soundtrackId: soundtrack._id,
    });

    authenticateUser(user);

    const response = await GET(createFavoritesRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      _id: soundtrack._id.toString(),
      title: "Time",
      movie: "Inception",
      composer: "Hans Zimmer",
    });
    expect(body[0]).not.toHaveProperty("userId");
    expect(body[0]).not.toHaveProperty("soundtrackId");
  });

  it("returns only the authenticated user's favorites", async () => {
    const authenticatedUser = await createUser(
      "Authenticated User",
      "authenticated@example.com",
    );
    const otherUser = await createUser("Other User", "other@example.com");
    const ownSoundtrack = await createSoundtrack(
      "Cornfield Chase",
      "Interstellar",
      "Hans Zimmer",
    );
    const otherSoundtrack = await createSoundtrack(
      "The Imperial March",
      "The Empire Strikes Back",
      "John Williams",
    );

    await Favorite.create([
      {
        userId: authenticatedUser._id,
        soundtrackId: ownSoundtrack._id,
      },
      {
        userId: otherUser._id,
        soundtrackId: otherSoundtrack._id,
      },
    ]);

    authenticateUser(authenticatedUser);

    const response = await GET(createFavoritesRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      _id: ownSoundtrack._id.toString(),
      title: "Cornfield Chase",
    });
    expect(body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: otherSoundtrack._id.toString(),
        }),
      ]),
    );
  });

  it("rejects a missing authentication token", async () => {
    const response = await GET(createFavoritesRequest());

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

    const response = await GET(createFavoritesRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });
});
