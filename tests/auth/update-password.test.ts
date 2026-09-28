import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { PUT } from "@/app/api/user/me/route";
import { generateToken } from "@/lib/jwt";
import User from "@/models/User";

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/user/me", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3001",
    },
    body: JSON.stringify(body),
  });
}

async function createAuthenticatedUser() {
  const user = await User.create({
    name: "Password Test User",
    email: "password-test@example.com",
    password: await bcrypt.hash("original123", 10),
  });

  cookieGetMock.mockReturnValue({
    name: "token",
    value: generateToken({
      id: user._id.toString(),
      email: user.email,
    }),
  });

  return user;
}

describe("PUT /api/user/me", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it.each([
    { label: "missing", body: {} },
    { label: "short", body: { password: "short" } },
  ])(
    "rejects a $label password without changing the stored hash",
    async ({ body }) => {
      const user = await createAuthenticatedUser();
      const originalHash = user.password;

      const response = await PUT(createRequest(body));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        message: "Password must be at least 6 characters long",
      });
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost:3001",
      );

      const storedUser = await User.findById(user._id);
      expect(storedUser?.password).toBe(originalHash);
    },
  );

  it("updates the password with a bcrypt hash", async () => {
    const user = await createAuthenticatedUser();

    const response = await PUT(createRequest({ password: "newsecret123" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Password updated successfully",
    });

    const storedUser = await User.findById(user._id);
    expect(storedUser?.password).not.toBe("newsecret123");
    await expect(
      bcrypt.compare("newsecret123", storedUser?.password ?? ""),
    ).resolves.toBe(true);
  });
});
