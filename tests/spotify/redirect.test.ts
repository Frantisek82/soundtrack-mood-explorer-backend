import { describe, expect, it } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  SPOTIFY_CALLBACK_RESULTS,
  spotifyCallbackResultUrl,
  type SpotifyCallbackResult,
} from "@/lib/spotify/redirect";

function configuration(production = false) {
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

describe("Spotify callback result URLs", () => {
  it.each(SPOTIFY_CALLBACK_RESULTS)(
    "returns the fixed local profile route for %s",
    (result) => {
      expect(spotifyCallbackResultUrl(configuration(), result)).toBe(
        `http://127.0.0.1:3001/profile?spotify=${result}`,
      );
    },
  );

  it("uses the configured production frontend origin", () => {
    expect(spotifyCallbackResultUrl(configuration(true), "connected")).toBe(
      "https://soundtrack-mood-explorer-frontend.vercel.app/profile?spotify=connected",
    );
  });

  it.each([
    "https://example.com",
    "//example.com",
    "connected&code=test-only-code",
    "",
  ])("rejects an unapproved result: %s", (value) => {
    expect(() =>
      spotifyCallbackResultUrl(configuration(), value as SpotifyCallbackResult),
    ).toThrow("Invalid Spotify callback result");
  });
});
