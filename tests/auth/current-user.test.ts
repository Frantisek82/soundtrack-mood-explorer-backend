import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { GET } from "@/app/api/user/me/route";
import { generateToken } from "@/lib/jwt";
import User from "@/models/User";

function createCurrentUserRequest() {
  return new Request("http://localhost/api/user/me", {
    method: "GET",
  });
}

function setAuthenticationToken(token: string) {
  cookieGetMock.mockReturnValue({
    name: "token",
    value: token,
  });
}

describe("GET /api/user/me", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("returns the authenticated user without the password", async () => {
    const user = await User.create({
      name: "Test User",
      email: "test@example.com",
      password: "stored-password",
    });

    setAuthenticationToken(
      generateToken({
        id: user._id.toString(),
        email: user.email,
      }),
    );

    const response = await GET(createCurrentUserRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      _id: user._id.toString(),
      name: "Test User",
      email: "test@example.com",
    });
    expect(body).not.toHaveProperty("password");
  });

  it("rejects a missing authentication token", async () => {
    const response = await GET(createCurrentUserRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("rejects an invalid authentication token", async () => {
    setAuthenticationToken("invalid-token");

    const response = await GET(createCurrentUserRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("rejects an expired authentication token", async () => {
    const token = jwt.sign(
      {
        id: new mongoose.Types.ObjectId().toString(),
        email: "test@example.com",
      },
      process.env.JWT_SECRET as string,
      {
        expiresIn: -1,
      },
    );

    setAuthenticationToken(token);

    const response = await GET(createCurrentUserRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("returns not found when a valid token references a nonexistent user", async () => {
    setAuthenticationToken(
      generateToken({
        id: new mongoose.Types.ObjectId().toString(),
        email: "missing@example.com",
      }),
    );

    const response = await GET(createCurrentUserRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "User not found",
    });
  });
});
