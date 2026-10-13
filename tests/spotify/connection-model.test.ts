import mongoose from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  decryptSpotifyCredential,
  encryptSpotifyCredential,
} from "@/lib/spotify/encryption";
import SpotifyConnection from "@/models/SpotifyConnection";

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

function connectionData(
  userId = new mongoose.Types.ObjectId(),
  accountId = "test-account",
) {
  const config = configuration();
  const ownership = { userId: userId.toHexString(), generation: 0 };

  return {
    userId,
    accountId,
    displayName: "Test Spotify User",
    status: "connected" as const,
    generation: 0,
    originalAuthorizedAt: new Date(),
    estimatedRefreshExpiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    accessExpiresAt: new Date(Date.now() + 3600 * 1000),
    accessToken: encryptSpotifyCredential(
      "test-only-access",
      { ...ownership, purpose: "access_token" },
      config,
    ),
    refreshToken: encryptSpotifyCredential(
      "test-only-refresh",
      { ...ownership, purpose: "refresh_token" },
      config,
    ),
    refreshLeaseOwner: "test-lease-owner",
    refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
  };
}

describe("SpotifyConnection persistence", () => {
  beforeAll(async () => {
    await SpotifyConnection.init();
  });

  it("stores encrypted credentials and excludes them from ordinary queries", async () => {
    const data = connectionData();
    const saved = await SpotifyConnection.create(data);

    const ordinary = await SpotifyConnection.findById(saved._id).lean();
    expect(ordinary).toHaveProperty("accountId", data.accountId);
    for (const field of [
      "accessToken",
      "refreshToken",
      "refreshLeaseOwner",
      "refreshLeaseExpiresAt",
    ]) {
      expect(ordinary).not.toHaveProperty(field);
    }

    const stored = await SpotifyConnection.findById(saved._id)
      .select("+accessToken +refreshToken")
      .lean();

    expect(stored).not.toBeNull();
    expect(
      decryptSpotifyCredential(
        stored?.accessToken,
        {
          userId: data.userId.toHexString(),
          generation: 0,
          purpose: "access_token",
        },
        configuration(),
      ),
    ).toBe("test-only-access");

    expect(JSON.stringify(stored)).not.toContain("test-only-access");
    expect(JSON.stringify(stored)).not.toContain("test-only-refresh");
  });

  it("prevents two connections for one application user", async () => {
    const userId = new mongoose.Types.ObjectId();
    await SpotifyConnection.create(connectionData(userId, "first-account"));

    await expect(
      SpotifyConnection.create(connectionData(userId, "second-account")),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("prevents one Spotify account belonging to two application users", async () => {
    await SpotifyConnection.create(connectionData());

    await expect(
      SpotifyConnection.create(connectionData()),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("blocks direct document JSON serialization even with selected credentials", async () => {
    const saved = await SpotifyConnection.create(connectionData());
    const selected = await SpotifyConnection.findById(saved._id).select(
      "+accessToken +refreshToken",
    );

    expect(() => JSON.stringify(selected)).toThrow(
      "Spotify connections require an explicit public DTO",
    );
  });

  it("requires credentials for a connected record", async () => {
    const data = connectionData();
    const record = new SpotifyConnection({
      ...data,
      accessToken: undefined,
      refreshToken: undefined,
    });

    await expect(record.validate()).rejects.toThrow();
  });

  it("permits a reauthorization record without credentials", async () => {
    const data = connectionData();
    const saved = await SpotifyConnection.create({
      ...data,
      status: "reauthorization_required",
      accessToken: undefined,
      refreshToken: undefined,
      accessExpiresAt: undefined,
      refreshLeaseOwner: undefined,
      refreshLeaseExpiresAt: undefined,
    });

    expect(saved.status).toBe("reauthorization_required");
  });

  it("rejects unknown plaintext credential fields", () => {
    expect(
      () =>
        new SpotifyConnection({
          ...connectionData(),
          plaintextAccessToken: "test-only-plaintext",
        }),
    ).toThrow();
  });

  it("rejects malformed encryption envelopes", async () => {
    const data = connectionData();
    const record = new SpotifyConnection({
      ...data,
      accessToken: {
        ...data.accessToken,
        tag: Buffer.alloc(8).toString("base64"),
      },
    });

    await expect(record.validate()).rejects.toThrow();
  });
});
