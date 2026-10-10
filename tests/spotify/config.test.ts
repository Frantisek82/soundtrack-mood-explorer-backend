import { describe, expect, it } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";

const testKey = Buffer.alloc(32, 1).toString("base64");

function validEnvironment(): Record<string, string> {
  return {
    SPOTIFY_ENABLED: "true",
    SPOTIFY_CLIENT_ID: "a".repeat(32),
    SPOTIFY_FRONTEND_ORIGIN: "http://127.0.0.1:3001",
    SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/spotify/callback",
    SPOTIFY_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ test: testKey }),
    SPOTIFY_TOKEN_ACTIVE_KEY_ID: "test",
  };
}

describe("Spotify configuration", () => {
  it("defaults to disabled without requiring credentials", () => {
    expect(getSpotifyConfig({})).toEqual({
      enabled: false,
      reason: "disabled",
    });
  });

  it("allows explicit disablement", () => {
    expect(getSpotifyConfig({ SPOTIFY_ENABLED: "false" })).toEqual({
      enabled: false,
      reason: "disabled",
    });
  });

  it("disables previews even when enabled or incomplete", () => {
    expect(
      getSpotifyConfig({
        VERCEL_ENV: "preview",
        SPOTIFY_ENABLED: "true",
      }),
    ).toEqual({ enabled: false, reason: "preview" });
  });

  it("accepts the exact local configuration", () => {
    const config = getSpotifyConfig(validEnvironment());
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("Expected enabled configuration");

    expect(config.frontendOrigin).toBe("http://127.0.0.1:3001");
    expect(config.encryptionKeys.get("test")).toEqual(Buffer.alloc(32, 1));
  });

  it("accepts the exact production configuration", () => {
    const env = validEnvironment();
    env.VERCEL_ENV = "production";
    env.SPOTIFY_FRONTEND_ORIGIN =
      "https://soundtrack-mood-explorer-frontend.vercel.app";
    env.SPOTIFY_REDIRECT_URI =
      "https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback";

    expect(getSpotifyConfig(env).enabled).toBe(true);
  });

  it.each([
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_FRONTEND_ORIGIN",
    "SPOTIFY_REDIRECT_URI",
    "SPOTIFY_TOKEN_ENCRYPTION_KEYS",
    "SPOTIFY_TOKEN_ACTIVE_KEY_ID",
  ])("rejects missing %s without exposing values", (name) => {
    const env = validEnvironment();
    delete env[name];

    expect(() => getSpotifyConfig(env)).toThrow(
      `Invalid Spotify configuration: ${name}`,
    );
  });

  it.each([
    ["SPOTIFY_ENABLED", "yes"],
    ["SPOTIFY_CLIENT_ID", "private-invalid-value"],
    ["SPOTIFY_FRONTEND_ORIGIN", "http://localhost:3001"],
    ["SPOTIFY_FRONTEND_ORIGIN", "http://127.0.0.1:3001/"],
    ["SPOTIFY_FRONTEND_ORIGIN", "https://example.com"],
    [
      "SPOTIFY_FRONTEND_ORIGIN",
      "https://soundtrack-mood-explorer-frontend.vercel.app.evil.test",
    ],
    ["SPOTIFY_REDIRECT_URI", "http://localhost:3000/api/spotify/callback"],
    ["SPOTIFY_TOKEN_ENCRYPTION_KEYS", "not-json"],
    ["SPOTIFY_TOKEN_ENCRYPTION_KEYS", "[]"],
    ["SPOTIFY_TOKEN_ENCRYPTION_KEYS", "{}"],
    [
      "SPOTIFY_TOKEN_ENCRYPTION_KEYS",
      JSON.stringify({ test: Buffer.alloc(16).toString("base64") }),
    ],
    ["SPOTIFY_TOKEN_ACTIVE_KEY_ID", "unknown"],
  ])("rejects invalid %s", (name, value) => {
    const env = validEnvironment();
    env[name] = value;

    expect(() => getSpotifyConfig(env)).toThrow(
      "Invalid Spotify configuration:",
    );
  });

  it("rejects mixed local and production URLs", () => {
    const env = validEnvironment();
    env.SPOTIFY_FRONTEND_ORIGIN =
      "https://soundtrack-mood-explorer-frontend.vercel.app";

    expect(() => getSpotifyConfig(env)).toThrow();
  });

  it("rejects local URLs on a Vercel production deployment", () => {
    const env = validEnvironment();
    env.VERCEL_ENV = "production";

    expect(() => getSpotifyConfig(env)).toThrow(
      "Invalid Spotify configuration: production deployment URLs",
    );
  });

  it("does not include malformed credential values in errors", () => {
    const env = validEnvironment();
    env.SPOTIFY_TOKEN_ENCRYPTION_KEYS = "private-malformed-keyring";

    expect(() => getSpotifyConfig(env)).toThrow(
      /^Invalid Spotify configuration: SPOTIFY_TOKEN_ENCRYPTION_KEYS$/,
    );
  });
});
