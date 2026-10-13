import mongoose from "mongoose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSpotifyPersistenceReady } from "@/lib/spotify/readiness";
import User from "@/models/User";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";

describe("Spotify persistence readiness", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies real indexes and transaction support in the isolated database", async () => {
    await expect(assertSpotifyPersistenceReady()).resolves.toBeUndefined();
  });

  it.each([
    { setName: undefined },
    { isWritablePrimary: false },
    { readOnly: true },
    { logicalSessionTimeoutMinutes: null },
    { maxWireVersion: 6 },
  ])("rejects unsupported database capabilities: %j", async (override) => {
    const database = mongoose.connection.db;
    if (!database) throw new Error("Missing test database");

    vi.spyOn(database, "command").mockResolvedValue({
      setName: "test-replica-set",
      isWritablePrimary: true,
      logicalSessionTimeoutMinutes: 30,
      maxWireVersion: 25,
      ...override,
    });

    await expect(assertSpotifyPersistenceReady()).rejects.toThrow(
      /^Spotify persistence is not ready$/,
    );
  });

  it("rejects missing connection uniqueness indexes", async () => {
    vi.spyOn(SpotifyConnection.collection, "indexes").mockResolvedValue([]);

    await expect(assertSpotifyPersistenceReady()).rejects.toThrow(
      /^Spotify persistence is not ready$/,
    );
  });

  it("rejects an incorrect transaction TTL index", async () => {
    const indexes = await SpotifyOAuthTransaction.collection.indexes();
    const changed = indexes.map((index) =>
      index.key?.expiresAt === 1
        ? { ...index, expireAfterSeconds: 600 }
        : index,
    );

    vi.spyOn(SpotifyOAuthTransaction.collection, "indexes").mockResolvedValue(
      changed,
    );

    await expect(assertSpotifyPersistenceReady()).rejects.toThrow(
      /^Spotify persistence is not ready$/,
    );
  });

  it("fails closed if index creation fails without exposing database details", async () => {
    vi.spyOn(SpotifyConnection, "createIndexes").mockRejectedValue(
      new Error("test-only-private-database-details"),
    );

    await expect(assertSpotifyPersistenceReady()).rejects.toThrow(
      /^Spotify persistence is not ready$/,
    );
  });

  it("fails closed if the transaction probe fails", async () => {
    vi.spyOn(mongoose.connection, "transaction").mockRejectedValue(
      new Error("test-only-transaction-failure"),
    );

    await expect(assertSpotifyPersistenceReady()).rejects.toThrow(
      /^Spotify persistence is not ready$/,
    );
  });
});
