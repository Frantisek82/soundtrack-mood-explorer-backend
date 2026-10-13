import { describe, expect, it } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  decryptSpotifyCredential,
  encryptSpotifyCredential,
  type CredentialContext,
  type CredentialPurpose,
} from "@/lib/spotify/encryption";

const context: CredentialContext = {
  userId: "a".repeat(24),
  generation: 0,
  purpose: "access_token",
};

function configuration(activeKeyId = "old") {
  const config = getSpotifyConfig({
    SPOTIFY_ENABLED: "true",
    SPOTIFY_CLIENT_ID: "a".repeat(32),
    SPOTIFY_FRONTEND_ORIGIN: "http://127.0.0.1:3001",
    SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/spotify/callback",
    SPOTIFY_TOKEN_ENCRYPTION_KEYS: JSON.stringify({
      old: Buffer.alloc(32, 1).toString("base64"),
      next: Buffer.alloc(32, 2).toString("base64"),
    }),
    SPOTIFY_TOKEN_ACTIVE_KEY_ID: activeKeyId,
  });

  if (!config.enabled) throw new Error("Expected enabled configuration");
  return config;
}

function changeByte(encoded: string): string {
  const bytes = Buffer.from(encoded, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

describe("Spotify credential encryption", () => {
  it.each<CredentialPurpose>([
    "access_token",
    "refresh_token",
    "pkce_verifier",
  ])("round-trips %s", (purpose) => {
    const config = configuration();
    const ownership = { ...context, purpose };
    const envelope = encryptSpotifyCredential(
      "test-only-credential",
      ownership,
      config,
    );

    expect(decryptSpotifyCredential(envelope, ownership, config)).toBe(
      "test-only-credential",
    );
    expect(JSON.stringify(envelope)).not.toContain("test-only-credential");
  });

  it("uses a fresh IV for each encryption", () => {
    const config = configuration();
    const first = encryptSpotifyCredential("same-value", context, config);
    const second = encryptSpotifyCredential("same-value", context, config);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it.each(["iv", "tag", "ciphertext"] as const)(
    "rejects tampered %s",
    (field) => {
      const config = configuration();
      const envelope = encryptSpotifyCredential("test-value", context, config);
      envelope[field] = changeByte(envelope[field]);

      expect(() => decryptSpotifyCredential(envelope, context, config)).toThrow(
        "Spotify credential operation failed",
      );
    },
  );

  it.each([
    { ...context, userId: "b".repeat(24) },
    { ...context, generation: 1 },
    { ...context, purpose: "refresh_token" as const },
  ])("rejects a changed ownership context: %j", (changed) => {
    const config = configuration();
    const envelope = encryptSpotifyCredential("test-value", context, config);

    expect(() => decryptSpotifyCredential(envelope, changed, config)).toThrow(
      "Spotify credential operation failed",
    );
  });

  it("rejects unknown keys", () => {
    const config = configuration();
    const envelope = encryptSpotifyCredential("test-value", context, config);

    expect(() =>
      decryptSpotifyCredential(
        { ...envelope, keyId: "missing" },
        context,
        config,
      ),
    ).toThrow("Spotify credential operation failed");
  });

  it("rejects incorrect key material", () => {
    const config = configuration();
    const envelope = encryptSpotifyCredential("test-value", context, config);
    const changed = {
      ...config,
      encryptionKeys: new Map([["old", Buffer.alloc(32, 3)]]),
    };

    expect(() => decryptSpotifyCredential(envelope, context, changed)).toThrow(
      "Spotify credential operation failed",
    );
  });

  it("supports old-key reads after changing the active key", () => {
    const previous = configuration();
    const envelope = encryptSpotifyCredential("old-value", context, previous);
    const rotated = configuration("next");

    expect(decryptSpotifyCredential(envelope, context, rotated)).toBe(
      "old-value",
    );
    expect(encryptSpotifyCredential("new-value", context, rotated).keyId).toBe(
      "next",
    );
  });

  it("fails closed after an old key is removed", () => {
    const envelope = encryptSpotifyCredential(
      "old-value",
      context,
      configuration(),
    );
    const rotated = configuration("next");
    const retired = {
      ...rotated,
      encryptionKeys: new Map([["next", Buffer.alloc(32, 2)]]),
    };

    expect(() => decryptSpotifyCredential(envelope, context, retired)).toThrow(
      "Spotify credential operation failed",
    );
  });

  it.each([null, "plaintext-is-not-an-envelope", {}, { version: 2 }])(
    "rejects malformed envelopes: %j",
    (envelope) => {
      expect(() =>
        decryptSpotifyCredential(envelope, context, configuration()),
      ).toThrow("Spotify credential operation failed");
    },
  );

  it("rejects malformed encoding and shortened authentication tags", () => {
    const config = configuration();
    const envelope = encryptSpotifyCredential("test-value", context, config);

    for (const changed of [
      { ...envelope, iv: "not-base64" },
      { ...envelope, tag: Buffer.alloc(8).toString("base64") },
      { ...envelope, ciphertext: "" },
    ]) {
      expect(() => decryptSpotifyCredential(changed, context, config)).toThrow(
        "Spotify credential operation failed",
      );
    }
  });

  it.each(["", "a".repeat(16_385)])(
    "rejects empty or oversized credentials",
    (value) => {
      expect(() =>
        encryptSpotifyCredential(value, context, configuration()),
      ).toThrow("Spotify credential operation failed");
    },
  );

  it("rejects invalid generation context", () => {
    expect(() =>
      encryptSpotifyCredential(
        "test-value",
        { ...context, generation: -1 },
        configuration(),
      ),
    ).toThrow("Spotify credential operation failed");
  });
});
