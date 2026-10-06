import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { GET } from "@/app/api/favorites/[id]/route";
import { generateToken } from "@/lib/jwt";
import Favorite from "@/models/Favorite";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createFavoriteStatusRequest(soundtrackId: string) {
  return new Request(`http://localhost/api/favorites/${soundtrackId}`, {
    method: "GET",
  });
}

function createRouteContext(soundtrackId: string) {
  return {
    params: Promise.resolve({ id: soundtrackId }),
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

describe("GET /api/favorites/:id", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("returns true when the soundtrack is in the authenticated user's favorites", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();

    await Favorite.create({
      userId: user._id,
      soundtrackId: soundtrack._id,
    });

    authenticateUser(user);

    const soundtrackId = soundtrack._id.toString();
    const response = await GET(
      createFavoriteStatusRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isFavorite: true,
    });
  });

  it("returns false when the soundtrack is not a favorite", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    authenticateUser(user);

    const soundtrackId = soundtrack._id.toString();
    const response = await GET(
      createFavoriteStatusRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isFavorite: false,
    });
  });

  it("does not expose another user's favorite", async () => {
    const authenticatedUser = await createUser(
      "Authenticated User",
      "authenticated@example.com",
    );
    const otherUser = await createUser("Other User", "other@example.com");
    const soundtrack = await createSoundtrack();

    await Favorite.create({
      userId: otherUser._id,
      soundtrackId: soundtrack._id,
    });

    authenticateUser(authenticatedUser);

    const soundtrackId = soundtrack._id.toString();
    const response = await GET(
      createFavoriteStatusRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isFavorite: false,
    });
  });

  it("rejects a missing authentication token", async () => {
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await GET(
      createFavoriteStatusRequest(soundtrackId),
      createRouteContext(soundtrackId),
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

    const soundtrackId = new Soundtrack()._id.toString();
    const response = await GET(
      createFavoriteStatusRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("preserves the unauthorized response for a malformed soundtrack ID", async () => {
    const user = await createUser("Test User", "test@example.com");
    authenticateUser(user);

    const soundtrackId = "not-an-object-id";
    const response = await GET(
      createFavoriteStatusRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });
});
