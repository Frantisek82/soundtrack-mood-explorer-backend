import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  clearSpotifyTransactionCookie,
  createSpotifyBrowserBinding,
  setSpotifyTransactionCookie,
  SPOTIFY_TRANSACTION_COOKIE,
} from "@/lib/spotify/cookies";

function configuration(production: boolean) {
  const config = getSpotifyConfig({
    SPOTIFY_ENABLED: "true",
    SPOTIFY_CLIENT_ID: "a".repeat(32),
    SPOTIFY_FRONTEND_ORIGIN: production
      ? "https://soundtrack-mood-explorer-frontend.vercel.app"
      : "http://127.0.0.1:3001",
    SPOTIFY_REDIRECT_URI: production
      ? "https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback"
      : "http://127.0.0.1:3000/api/spotify/callback",
    SPOTIFY_TOKEN_ENCRYPTION_KEYS: JSON.stringify({
      test: Buffer.alloc(32, 1).toString("base64"),
    }),
    SPOTIFY_TOKEN_ACTIVE_KEY_ID: "test",
  });

  if (!config.enabled) throw new Error("Expected enabled configuration");
  return config;
}

describe("Spotify transaction cookie", () => {
  it("generates distinct URL-safe 32-byte browser bindings", () => {
    const first = createSpotifyBrowserBinding();
    const second = createSpotifyBrowserBinding();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, "base64url").length).toBe(32);
    expect(first).not.toBe(second);
  });

  it.each([false, true])(
    "sets a short-lived host-only cookie; HTTPS=%s",
    (production) => {
      const response = NextResponse.json({});
      const binding = createSpotifyBrowserBinding();

      setSpotifyTransactionCookie(response, binding, configuration(production));

      expect(response.cookies.get(SPOTIFY_TRANSACTION_COOKIE)).toMatchObject({
        value: binding,
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/api/spotify",
        maxAge: 600,
      });

      const header = response.headers.get("set-cookie")?.toLowerCase() ?? "";
      expect(header).toContain("httponly");
      expect(header).toContain("samesite=lax");
      expect(header).toContain("path=/api/spotify");
      expect(header).toContain("max-age=600");
      expect(header).not.toContain("domain=");
      expect(header.includes("; secure")).toBe(production);
    },
  );

  it.each([false, true])(
    "clears with matching attributes; HTTPS=%s",
    (production) => {
      const response = NextResponse.json({});
      const config = configuration(production);

      setSpotifyTransactionCookie(
        response,
        createSpotifyBrowserBinding(),
        config,
      );
      clearSpotifyTransactionCookie(response, config);

      expect(response.cookies.get(SPOTIFY_TRANSACTION_COOKIE)).toMatchObject({
        value: "",
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/api/spotify",
        maxAge: 0,
      });

      const header = response.headers.get("set-cookie")?.toLowerCase() ?? "";
      expect(header).toContain("max-age=0");
      expect(header).toContain("expires=thu, 01 jan 1970 00:00:00 gmt");
      expect(header).not.toContain("domain=");
      expect(header.includes("; secure")).toBe(production);
    },
  );

  it.each(["", "short", "a".repeat(44), "!".repeat(43)])(
    "rejects malformed binding %s before setting a cookie",
    (binding) => {
      const response = NextResponse.json({});

      expect(() =>
        setSpotifyTransactionCookie(response, binding, configuration(false)),
      ).toThrow("Invalid Spotify browser binding");

      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );
});
