import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/login/route";
import { verifyToken } from "@/lib/jwt";
import User from "@/models/User";

describe("POST /api/auth/login production cookie", () => {
  it("sets Secure and SameSite=None in production", async () => {
    const user = await User.create({
      name: "Production Cookie User",
      email: "production-cookie@example.com",
      password: await bcrypt.hash("secret123", 10),
    });

    let response: Awaited<ReturnType<typeof POST>>;

    vi.stubEnv("NODE_ENV", "production");
    try {
      response = await POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: user.email,
            password: "secret123",
          }),
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }

    expect(response.status).toBe(200);

    const token = response.cookies.get("token")?.value ?? "";
    expect(verifyToken(token).id).toBe(user._id.toString());

    const setCookie = response.headers.get("set-cookie")?.toLowerCase() ?? "";
    expect(setCookie).toContain("token=");
    expect(setCookie).toContain("path=/");
    expect(setCookie).toContain("max-age=86400");
    expect(setCookie).toContain("httponly");
    expect(setCookie).toContain("secure");
    expect(setCookie).toContain("samesite=none");
  });
});
