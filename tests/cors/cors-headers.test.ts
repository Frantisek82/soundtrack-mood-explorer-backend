import { describe, expect, it } from "vitest";

import { getCorsHeaders } from "@/lib/cors";

describe("getCorsHeaders", () => {
  it.each([
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://soundtrack-mood-explorer-frontend.vercel.app",
    "https://soundtrack-mood-explorer-frontend-git-feature.vercel.app",
  ])("allows the frontend origin %s", (origin) => {
    expect(getCorsHeaders(origin)["Access-Control-Allow-Origin"]).toBe(origin);
  });

  it.each(["https://example.com", null, undefined])(
    "uses the production frontend origin for a disallowed or missing origin: %s",
    (origin) => {
      expect(getCorsHeaders(origin)["Access-Control-Allow-Origin"]).toBe(
        "https://soundtrack-mood-explorer-frontend.vercel.app",
      );
    },
  );

  it("allows the current methods and request headers with credentials", () => {
    expect(getCorsHeaders("http://localhost:3001")).toEqual({
      "Access-Control-Allow-Origin": "http://localhost:3001",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    });
  });
});
