import mongoose from "mongoose";
import { DeletionHistoryStorageError } from "@/lib/deletion-history/client";
import { openDeletionHistoryDatabase } from "@/lib/deletion-history/client";
import * as intentStoreModule from "@/lib/deletion-history/store";

import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

import { DELETE } from "@/app/api/user/me/route";
import { generateToken } from "@/lib/jwt";
import type { SpotifyConfig } from "@/lib/spotify/config";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { createSpotifyOAuthTransaction } from "@/lib/spotify/transactions";
import Favorite from "@/models/Favorite";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import User from "@/models/User";

const config: Extract<SpotifyConfig, { enabled: true }> = {
  enabled: true,
  clientId: "a".repeat(32),
  frontendOrigin: "http://127.0.0.1:3001",
  redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
  encryptionKeys: new Map([["test", Buffer.alloc(32, 1)]]),
  activeKeyId: "test",
};

function request(https = false) {
  return new Request(
    https
      ? "https://soundtrack-mood-explorer-backend.vercel.app/api/user/me"
      : "http://127.0.0.1:3000/api/user/me",
    {
      method: "DELETE",
      headers: {
        Origin: https
          ? "https://soundtrack-mood-explorer-frontend.vercel.app"
          : "http://127.0.0.1:3001",
      },
    },
  );
}

async function fixture(suffix = "owner", linked = true) {
  const user = await User.create({
    name: "Delete Route User",
    email: `delete-route-${suffix}@example.com`,
    password: "test-only-password",
  });
  const userId = user._id.toString();
  const token = generateToken({ id: userId, email: user.email });

  cookieGetMock.mockReturnValue({ value: token });

  await Favorite.collection.insertOne({
    userId: new Types.ObjectId(userId),
    soundtrackId: new Types.ObjectId(),
  });

  if (linked) {
    const time = Date.now();
    await persistSpotifyAccountLink({
      userId,
      generation: 0,
      config,
      authorization: {
        accountId: `test-only-delete-route-${suffix}`,
        displayName: "Test Listener",
        accessToken: "test-only-access",
        refreshToken: "test-only-refresh",
        grantedScopes: [],
        authorizedAt: new Date(time),
        accessExpiresAt: new Date(time + 3_600_000),
      },
    });

    for (let index = 0; index < 2; index += 1) {
      await createSpotifyOAuthTransaction({
        userId, generation: 0, sessionToken: token, config,
      });
    }
  }

  return { user, userId, token };
}

describe("Account-deletion route with Spotify cleanup", () => {
  beforeAll(async () => {
    await User.init();
    await Favorite.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    cookieGetMock.mockReset();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden during account deletion"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it("preserves the success response and removes all data in scope", async () => {
    const { userId } = await fixture();
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Account deleted successfully",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin"))
      .toBe("http://127.0.0.1:3001");

    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);
  });

  it("clears both the authentication and local Spotify transaction cookies", async () => {
    await fixture();
    const response = await DELETE(request());

    const auth = response.cookies.get("token");
    expect(auth?.value).toBe("");
    expect(auth?.path).toBe("/");
    expect(auth?.expires).toEqual(new Date(0));

    const binding = response.cookies.get("spotify_oauth");
    expect(binding?.value).toBe("");
    expect(binding?.path).toBe("/api/spotify");
    expect(binding?.httpOnly).toBe(true);
    expect(binding?.sameSite).toBe("lax");
    expect(binding?.maxAge).toBe(0);
    expect(binding?.expires).toEqual(new Date(0));
    expect(binding?.domain).toBeUndefined();
    expect(binding?.secure).not.toBe(true);
  });

  it("clears the HTTPS Spotify cookie with Secure", async () => {
    await fixture();
    const response = await DELETE(request(true));

    expect(response.status).toBe(200);
    expect(response.cookies.get("spotify_oauth")?.secure).toBe(true);
    expect(response.cookies.get("spotify_oauth")?.path).toBe("/api/spotify");
  });

  it("deletes an account that has never linked Spotify", async () => {
    const { userId } = await fixture("unlinked", false);
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
  });

  it.each([
    ["SPOTIFY_ENABLED", "false"],
    ["SPOTIFY_CLIENT_ID", ""],
    ["SPOTIFY_TOKEN_ENCRYPTION_KEYS", "invalid-test-configuration"],
  ])("does not block account deletion for %s=%s", async (name, value) => {
    const { userId } = await fixture();
    vi.stubEnv("SPOTIFY_ENABLED", "true");
    vi.stubEnv(name, value);

    const response = await DELETE(request());
    expect(response.status).toBe(200);
    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    expect(response.cookies.get("spotify_oauth")?.value).toBe("");
  });

  it("deletes only the authenticated user's data", async () => {
    const owner = await fixture();
    const other = await fixture("other");
    cookieGetMock.mockReturnValue({ value: owner.token });

    expect((await DELETE(request())).status).toBe(200);

    await expect(User.findById(other.userId)).resolves.not.toBeNull();
    await expect(Favorite.countDocuments({ userId: other.userId })).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId: other.userId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId: other.userId })).resolves.toBe(2);
  });

  it("rejects missing authentication without clearing cookies", async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(401);
    expect(response.headers.has("set-cookie")).toBe(false);
    await expect(response.json()).resolves.toEqual({ message: "Unauthorized" });
  });

  it("rejects invalid authentication", async () => {
    cookieGetMock.mockReturnValue({ value: "invalid-token" });
    const response = await DELETE(request());
    expect(response.status).toBe(401);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("rejects an expired session without deleting the user", async () => {
    const { user, userId } = await fixture();
    cookieGetMock.mockReturnValue({
      value: jwt.sign(
        { id: userId, email: user.email },
        process.env.JWT_SECRET as string,
        { expiresIn: -1 },
      ),
    });

    expect((await DELETE(request())).status).toBe(401);
    await expect(User.findById(userId)).resolves.not.toBeNull();
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
  });

  it("rejects a signed malformed application user identifier", async () => {
    cookieGetMock.mockReturnValue({
      value: generateToken({
        id: "invalid-user-id",
        email: "test@example.com",
      }),
    });

    expect((await DELETE(request())).status).toBe(401);
  });

  it("rejects a session for an already deleted User", async () => {
    const { userId } = await fixture();
    await User.deleteOne({ _id: userId });

    const response = await DELETE(request());
    expect(response.status).toBe(401);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("returns 500 without clearing cookies when cleanup fails, and rolls back", async () => {
    const { userId } = await fixture();
    vi.spyOn(User, "deleteOne").mockImplementationOnce(() => {
      throw new Error("test-only-private-database-details");
    });

    const response = await DELETE(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);

    const user = await User.findById(userId).select("+spotifyLinkGeneration");
    expect(user?.spotifyLinkGeneration).toBe(0);
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(2);
  });

  async function readIntents() {
    const handle = await openDeletionHistoryDatabase();
    try {
      return await handle.database
        .collection("accountdeletionintents")
        .find({})
        .toArray();
    } finally {
      await handle.close();
    }
  }

  it("persists a completed deletion obligation independently of live cleanup", async () => {
    const { userId } = await fixture();
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(User.findById(userId)).resolves.toBeNull();

    const intents = await readIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      namespace: "synthetic-test",
      keyVersion: "test-v1",
      schemaVersion: 1,
      state: "completed",
    });
    expect(intents[0].digest).toMatch(/^[a-f0-9]{64}$/);
    expect(intents[0].acceptedAt).toBeInstanceOf(Date);
    expect(intents[0].completedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(intents)).not.toContain(userId);
    expect(await User.db.db!.collection("accountdeletionintents").countDocuments())
      .toBe(0);
  });

  it("keeps pending intent after rollback and completes that same intent on retry", async () => {
    const { userId } = await fixture();
    vi.spyOn(User, "deleteOne").mockImplementationOnce(() => {
      throw new Error("synthetic-cleanup-failure");
    });

    const failed = await DELETE(request());
    expect(failed.status).toBe(500);
    expect(failed.headers.has("set-cookie")).toBe(false);
    await expect(User.findById(userId)).resolves.not.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(2);

    const pending = await readIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0].state).toBe("pending");
    expect(pending[0].completedAt).toBeUndefined();

    const retried = await DELETE(request());
    expect(retried.status).toBe(200);
    const completed = await readIntents();
    expect(completed).toHaveLength(1);
    expect(completed[0]._id).toEqual(pending[0]._id);
    expect(completed[0].acceptedAt).toEqual(pending[0].acceptedAt);
    expect(completed[0].state).toBe("completed");
  });

  it("blocks cleanup when register configuration is unavailable", async () => {
    const { userId } = await fixture();
    vi.stubEnv("DELETION_HISTORY_MONGODB_URI", "");
    const deletion = vi.spyOn(User, "deleteOne");

    const response = await DELETE(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      message: "Account deletion temporarily unavailable",
    });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(deletion).not.toHaveBeenCalled();
    await expect(User.findById(userId)).resolves.not.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(2);
  });

  it("preserves success and cookie cleanup when completion recording fails after commit", async () => {
    const { userId } = await fixture();
    const realFactory = intentStoreModule.createDeletionIntentStore;
    vi.spyOn(intentStoreModule, "createDeletionIntentStore")
      .mockImplementation(database => ({
        ...realFactory(database),
        markLiveCleanupCompleted: async () => {
          throw new Error("synthetic-private-marker-failure");
        },
      }));

    const response = await DELETE(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Account deleted successfully",
    });
    expect(response.cookies.get("token")?.value).toBe("");
    expect(response.cookies.get("spotify_oauth")?.value).toBe("");
    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);

    const intents = await readIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0].state).toBe("pending");
  });

  it("does not record deletion intent for unauthenticated requests", async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await readIntents()).toHaveLength(0);
  });


  it("records intent once when the application transaction callback retries", async () => {
    const { userId } = await fixture();
    const factory = vi.spyOn(intentStoreModule, "createDeletionIntentStore");
    const transient = new mongoose.mongo.MongoServerError({
      message: "synthetic-transient-transaction-failure",
      errorLabels: ["TransientTransactionError"],
    });
    const deletion = vi.spyOn(User, "deleteOne")
      .mockImplementationOnce(() => { throw transient; });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(deletion.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(factory).toHaveBeenCalledOnce();
    await expect(User.findById(userId)).resolves.toBeNull();
    const intents = await readIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0].state).toBe("completed");
  });

  it("retains stored intent but blocks cleanup after a lost acknowledgement", async () => {
    const { userId } = await fixture();
    const realFactory = intentStoreModule.createDeletionIntentStore;
    const factory = vi.spyOn(intentStoreModule, "createDeletionIntentStore")
      .mockImplementation(database => {
        const realStore = realFactory(database);
        return {
          ...realStore,
          recordPending: async reference => {
            await realStore.recordPending(reference);
            throw new DeletionHistoryStorageError();
          },
        };
      });
    const deletion = vi.spyOn(User, "deleteOne");

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(deletion).not.toHaveBeenCalled();
    await expect(User.findById(userId)).resolves.not.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(1);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(1);
    const pending = await readIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0].state).toBe("pending");

    factory.mockRestore();
    expect((await DELETE(request())).status).toBe(200);
    const completed = await readIntents();
    expect(completed).toHaveLength(1);
    expect(completed[0]._id).toEqual(pending[0]._id);
    expect(completed[0].acceptedAt).toEqual(pending[0].acceptedAt);
    expect(completed[0].state).toBe("completed");
  });

  it("keeps intent pending when a committed transaction result is uncertain", async () => {
    const { userId } = await fixture();
    const originalTransaction = mongoose.connection.transaction;
    vi.spyOn(mongoose.connection, "transaction")
      .mockImplementationOnce(async function (
        this: typeof mongoose.connection,
        ...args
      ) {
        await Reflect.apply(originalTransaction, this, args);
        // Simulate loss of the successful outcome at the service boundary.
        throw new Error("synthetic-uncertain-commit-result");
      });

    const response = await DELETE(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
    expect(response.headers.has("set-cookie")).toBe(false);
    await expect(User.findById(userId)).resolves.toBeNull();
    await expect(Favorite.countDocuments({ userId })).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
    const intents = await readIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0].state).toBe("pending");
    expect(intents[0].completedAt).toBeUndefined();
  });

});
