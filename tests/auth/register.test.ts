import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/register/route";
import User from "@/models/User";

function createRegisterRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  it("registers a user with normalized values and a hashed password", async () => {
    const response = await POST(
      createRegisterRequest({
        name: "  Test User  ",
        email: "  TEST@Example.COM  ",
        password: "secret123",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      message: "User registered successfully",
    });
    expect(response.headers.get("set-cookie")).toBeNull();

    const user = await User.findOne({ email: "test@example.com" });

    expect(user).not.toBeNull();
    expect(user?.name).toBe("Test User");
    expect(user?.email).toBe("test@example.com");
    expect(user?.password).not.toBe("secret123");
    await expect(
      bcrypt.compare("secret123", user?.password ?? ""),
    ).resolves.toBe(true);
  });

  it.each([
    {
      label: "name",
      body: { email: "test@example.com", password: "secret123" },
    },
    {
      label: "email",
      body: { name: "Test User", password: "secret123" },
    },
    {
      label: "password",
      body: { name: "Test User", email: "test@example.com" },
    },
  ])("rejects a missing $label", async ({ body }) => {
    const response = await POST(createRegisterRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "All fields are required",
    });
  });

  it("rejects an invalid email address", async () => {
    const response = await POST(
      createRegisterRequest({
        name: "Test User",
        email: "invalid-email",
        password: "secret123",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid email format",
    });
  });

  it("rejects a password shorter than six characters", async () => {
    const response = await POST(
      createRegisterRequest({
        name: "Test User",
        email: "test@example.com",
        password: "short",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Password must be at least 6 characters long",
    });
  });

  it("rejects a duplicate normalized email address", async () => {
    await User.create({
      name: "Existing User",
      email: "test@example.com",
      password: "stored-password",
    });

    const response = await POST(
      createRegisterRequest({
        name: "Another User",
        email: "  TEST@EXAMPLE.COM  ",
        password: "secret123",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "User already exists",
    });
    await expect(User.countDocuments()).resolves.toBe(1);
  });
});
