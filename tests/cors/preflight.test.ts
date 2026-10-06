import { describe, expect, it } from "vitest";

import { OPTIONS as loginOptions } from "@/app/api/auth/login/route";
import { OPTIONS as soundtrackOptions } from "@/app/api/soundtracks/route";

const localOrigin = "http://localhost:3001";

function createPreflightRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: localOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
}

function expectCorsHeaders(response: Response) {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(localOrigin);
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
    "Content-Type, Authorization",
  );
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
}

describe("CORS preflight responses", () => {
  it("returns the auth route's JSON response with CORS headers", async () => {
    const response = await loginOptions(
      createPreflightRequest("/api/auth/login"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expectCorsHeaders(response);
  });

  it("returns the Soundtracks route's empty 204 response with CORS headers", async () => {
    const response = await soundtrackOptions(
      createPreflightRequest("/api/soundtracks"),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectCorsHeaders(response);
  });
});
