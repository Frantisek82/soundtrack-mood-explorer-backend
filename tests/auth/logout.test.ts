import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  it("returns success and clears the authentication cookie", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({
      message: "Logged out successfully",
    });

    const cookie = response.cookies.get("token");

    expect(cookie?.value).toBe("");
    const expires = cookie?.expires;

    expect(expires instanceof Date ? expires.getTime() : expires).toBe(0);

    const setCookie = response.headers.get("set-cookie")?.toLowerCase() ?? "";

    expect(setCookie).toContain("token=;");
    expect(setCookie).toContain("expires=thu, 01 jan 1970 00:00:00 gmt");
    expect(setCookie).toContain("path=/");
    expect(setCookie).toContain("httponly");
    expect(setCookie).toContain("secure");
    expect(setCookie).toContain("samesite=none");
  });
});
