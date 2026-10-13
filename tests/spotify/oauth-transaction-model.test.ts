import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  decryptSpotifyCredential,
  encryptSpotifyCredential,
} from "@/lib/spotify/encryption";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configuration() {
  const config = getSpotifyConfig({
    SPOTIFY_ENABLED: "true",
    SPOTIFY_CLIENT_ID: "a".repeat(32),
    SPOTIFY_FRONTEND_ORIGIN: "http://127.0.0.1:3001",
    SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/spotify/callback",
    SPOTIFY_TOKEN_ENCRYPTION_KEYS: JSON.stringify({
      test: Buffer.alloc(32, 1).toString("base64"),
    }),
    SPOTIFY_TOKEN_ACTIVE_KEY_ID: "test",
  });

  if (!config.enabled) throw new Error("Expected enabled configuration");
  return config;
}

function transactionData() {
  const userId = new mongoose.Types.ObjectId();

  return {
    userId,
    generation: 0,
    stateHash: hash(`test-state-${userId}`),
    browserBindingHash: hash("test-browser-binding"),
    sessionHash: hash("test-application-session"),
    verifier: encryptSpotifyCredential(
      "test-only-pkce-verifier",
      {
        userId: userId.toHexString(),
        generation: 0,
        purpose: "pkce_verifier",
      },
      configuration(),
    ),
    redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
    expiresAt: new Date(Date.now() + 600_000),
  };
}

describe("SpotifyOAuthTransaction persistence", () => {
  beforeAll(async () => {
    await SpotifyOAuthTransaction.init();
  });

  it("excludes transaction hashes and verifier from ordinary queries", async () => {
    const saved = await SpotifyOAuthTransaction.create(transactionData());
    const ordinary = await SpotifyOAuthTransaction.findById(saved._id).lean();

    for (const field of [
      "stateHash",
      "browserBindingHash",
      "sessionHash",
      "verifier",
    ]) {
      expect(ordinary).not.toHaveProperty(field);
    }
    expect(ordinary).toHaveProperty("generation", 0);
  });

  it("persists an encrypted verifier that the backend can explicitly select", async () => {
    const data = transactionData();
    const saved = await SpotifyOAuthTransaction.create(data);
    const selected = await SpotifyOAuthTransaction.findById(saved._id)
      .select("+verifier")
      .lean();

    expect(
      decryptSpotifyCredential(
        selected?.verifier,
        {
          userId: data.userId.toHexString(),
          generation: 0,
          purpose: "pkce_verifier",
        },
        configuration(),
      ),
    ).toBe("test-only-pkce-verifier");

    expect(JSON.stringify(selected)).not.toContain("test-only-pkce-verifier");
  });

  it("enforces unique state hashes across users", async () => {
    const first = transactionData();
    await SpotifyOAuthTransaction.create(first);

    await expect(
      SpotifyOAuthTransaction.create({
        ...transactionData(),
        stateHash: first.stateHash,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("allows several distinct transactions for the same user", async () => {
    const first = transactionData();
    await SpotifyOAuthTransaction.create(first);
    await SpotifyOAuthTransaction.create({
      ...first,
      stateHash: hash("another-test-state"),
    });

    await expect(
      SpotifyOAuthTransaction.countDocuments({ userId: first.userId }),
    ).resolves.toBe(2);
  });

  it("blocks direct JSON serialization", async () => {
    const saved = await SpotifyOAuthTransaction.create(transactionData());

    expect(() => JSON.stringify(saved)).toThrow(
      "Spotify OAuth transactions must not be serialized",
    );
  });

  it.each(["stateHash", "browserBindingHash", "sessionHash"])(
    "rejects malformed %s",
    async (field) => {
      const record = new SpotifyOAuthTransaction({
        ...transactionData(),
        [field]: "not-a-sha256-hash",
      });

      await expect(record.validate()).rejects.toThrow();
    },
  );

  it("rejects an unapproved callback URI", async () => {
    const record = new SpotifyOAuthTransaction({
      ...transactionData(),
      redirectUri: "https://example.com/callback",
    });

    await expect(record.validate()).rejects.toThrow();
  });

  it("requires an expiry and encrypted verifier", async () => {
    const record = new SpotifyOAuthTransaction({
      ...transactionData(),
      expiresAt: undefined,
      verifier: undefined,
    });

    await expect(record.validate()).rejects.toThrow();
  });

  it("rejects unexpected plaintext transaction fields", () => {
    expect(
      () =>
        new SpotifyOAuthTransaction({
          ...transactionData(),
          plaintextVerifier: "test-only-plaintext",
        }),
    ).toThrow();
  });
});
