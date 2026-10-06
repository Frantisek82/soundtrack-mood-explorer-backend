import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/login/route";
import { verifyToken } from "@/lib/jwt";
import User from "@/models/User";

function createLoginRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function createUser() {
  return User.create({
    name: "Test User",
    email: "test@example.com",
    password: await bcrypt.hash("secret123", 10),
  });
}

describe("POST /api/auth/login", () => {
  it("logs in with a normalized email and creates an authentication cookie", async () => {
    const user = await createUser();

    const response = await POST(
      createLoginRequest({
        email: "  TEST@Example.COM  ",
        password: "secret123",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({
      message: "Login successful",
      user: {
        id: user._id.toString(),
        email: "test@example.com",
      },
    });

    const cookie = response.cookies.get("token");

    expect(cookie?.value).toBeTruthy();

    const decoded = verifyToken(cookie?.value ?? "");

    expect(decoded.id).toBe(user._id.toString());
    expect(decoded.email).toBe("test@example.com");

    const setCookie = response.headers.get("set-cookie")?.toLowerCase() ?? "";

    expect(setCookie).toContain("token=");
    expect(setCookie).toContain("path=/");
    expect(setCookie).toContain("max-age=86400");
    expect(setCookie).toContain("httponly");
    expect(setCookie).toContain("samesite=lax");
    expect(setCookie).not.toContain("secure");
  });

  it.each([
    {
      label: "email",
      body: { password: "secret123" },
    },
    {
      label: "password",
      body: { email: "test@example.com" },
    },
  ])("rejects a missing $label", async ({ body }) => {
    const response = await POST(createLoginRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Email and password are required",
    });
  });

  it("rejects an invalid email address", async () => {
    const response = await POST(
      createLoginRequest({
        email: "invalid-email",
        password: "secret123",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid email format",
    });
  });

  it("rejects an unknown email address", async () => {
    const response = await POST(
      createLoginRequest({
        email: "missing@example.com",
        password: "secret123",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid credentials",
    });
  });

  it("rejects an incorrect password", async () => {
    await createUser();

    const response = await POST(
      createLoginRequest({
        email: "test@example.com",
        password: "incorrect-password",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid credentials",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
