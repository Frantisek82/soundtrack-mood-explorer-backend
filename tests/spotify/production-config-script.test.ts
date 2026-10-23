import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const success =
  "Spotify production configuration: PASS; OAuth remains disabled.";
const failure = "Spotify production configuration: FAIL";

function run(overrides: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [resolve("scripts/verify-spotify-production-config.mjs")],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        NODE_ENV: "test",
        NODE_NO_WARNINGS: "1",
        VERCEL_ENV: "production",
        SPOTIFY_ENABLED: "false",
        SPOTIFY_CLIENT_ID: "a".repeat(32),
        SPOTIFY_FRONTEND_ORIGIN:
          "https://soundtrack-mood-explorer-frontend.vercel.app",
        SPOTIFY_REDIRECT_URI:
          "https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback",
        SPOTIFY_TOKEN_ENCRYPTION_KEYS: JSON.stringify({
          test: Buffer.alloc(32, 1).toString("base64"),
        }),
        SPOTIFY_TOKEN_ACTIVE_KEY_ID: "test",
        ...overrides,
      },
    },
  );
}

describe("Production configuration verification script", () => {
  it("validates configuration while requiring OAuth to remain disabled", () => {
    const result = run();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(success);
    expect(result.stderr).toBe("");
  });

  it.each(["preview", "development", ""])(
    "rejects the non-production environment %j",
    VERCEL_ENV => {
      const result = run({ VERCEL_ENV });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(failure);
    },
  );

  it.each(["true", "", "yes"])(
    "rejects SPOTIFY_ENABLED=%j",
    SPOTIFY_ENABLED => {
      const result = run({ SPOTIFY_ENABLED });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(failure);
    },
  );

  it("reports invalid credentials without exposing their value", () => {
    const secret = "test-only-private-malformed-keyring";
    const result = run({ SPOTIFY_TOKEN_ENCRYPTION_KEYS: secret });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(failure);
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it("fails when production secrets are unavailable", () => {
    const result = run({
      SPOTIFY_CLIENT_ID: "",
      SPOTIFY_TOKEN_ENCRYPTION_KEYS: "",
      SPOTIFY_TOKEN_ACTIVE_KEY_ID: "",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(failure);
  });
});
