import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { DELETE } from "@/app/api/favorites/[id]/route";
import { generateToken } from "@/lib/jwt";
import Favorite from "@/models/Favorite";
import Soundtrack from "@/models/Soundtrack";
import User from "@/models/User";

function createDeleteFavoriteRequest(soundtrackId: string) {
  return new Request(`http://localhost/api/favorites/${soundtrackId}`, {
    method: "DELETE",
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

describe("DELETE /api/favorites/:id", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes the authenticated user's favorite", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();

    await Favorite.create({
      userId: user._id,
      soundtrackId: soundtrack._id,
    });

    authenticateUser(user);

    const soundtrackId = soundtrack._id.toString();
    const response = await DELETE(
      createDeleteFavoriteRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
    });
    await expect(
      Favorite.countDocuments({
        userId: user._id,
        soundtrackId: soundtrack._id,
      }),
    ).resolves.toBe(0);
  });

  it("does not delete another user's favorite", async () => {
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
    const response = await DELETE(
      createDeleteFavoriteRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
    });
    await expect(
      Favorite.countDocuments({
        userId: otherUser._id,
        soundtrackId: soundtrack._id,
      }),
    ).resolves.toBe(1);
  });

  it("returns success when no matching favorite exists", async () => {
    const user = await createUser("Test User", "test@example.com");
    const soundtrack = await createSoundtrack();
    authenticateUser(user);

    const soundtrackId = soundtrack._id.toString();
    const response = await DELETE(
      createDeleteFavoriteRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
    });
  });

  it("rejects a missing authentication token", async () => {
    const soundtrackId = new Soundtrack()._id.toString();
    const response = await DELETE(
      createDeleteFavoriteRequest(soundtrackId),
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
    const response = await DELETE(
      createDeleteFavoriteRequest(soundtrackId),
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
    const response = await DELETE(
      createDeleteFavoriteRequest(soundtrackId),
      createRouteContext(soundtrackId),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });
});
