import { setImmediate as nextTurn } from "node:timers/promises";
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

import { DELETE as deleteAccount } from "@/app/api/user/me/route";
import { GET as callback } from "@/app/api/spotify/callback/route";
import { POST as connect } from "@/app/api/spotify/connect/route";
import { DELETE as disconnect } from "@/app/api/spotify/disconnect/route";
import { generateToken } from "@/lib/jwt";
import { getSpotifyAccessToken } from "@/lib/spotify/access-token";
import { getSpotifyConfig } from "@/lib/spotify/config";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { readSpotifyCurrentProfile } from "@/lib/spotify/read-profile";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import User from "@/models/User";
import Favorite from "@/models/Favorite";

const origin = "http://127.0.0.1:3001";
const cookieValues = new Map<string, string>();
type Action = "disconnect" | "delete";

function enabledConfig() {
  const config = getSpotifyConfig();
  if (!config.enabled) throw new Error("Expected enabled test configuration");
  return config;
}

function tokenResponse() {
  return Response.json({
    access_token: "test-only-new-access",
    refresh_token: "test-only-new-refresh",
    token_type: "Bearer",
    expires_in: 3600,
  });
}

function profileResponse() {
  return Response.json({
    account_id: "test-only-race-account",
    display_name: "Test Listener",
  });
}

function pendingResponse() {
  let release!: (response: Response) => void;
  const promise = new Promise<Response>(resolve => { release = resolve; });
  return { promise, release };
}

async function authenticate() {
  const user = await User.create({
    name: "Cleanup Race User",
    email: "cleanup-races@example.com",
    password: "test-only-password",
  });
  const userId = user._id.toString();
  cookieValues.set("token", generateToken({ id: userId, email: user.email }));
  return userId;
}

async function seedConnection(userId: string, expired = false) {
  const time = Date.now();
  await persistSpotifyAccountLink({
    userId,
    generation: 0,
    config: enabledConfig(),
    authorization: {
      accountId: "test-only-race-account",
      displayName: "Test Listener",
      accessToken: "test-only-old-access",
      refreshToken: "test-only-old-refresh",
      grantedScopes: [],
      authorizedAt: new Date(time - 3_600_000),
      accessExpiresAt: new Date(time + (expired ? 0 : 3_600_000)),
    },
  });
}

async function start() {
  const response = await connect(new Request(
    "http://127.0.0.1:3000/api/spotify/connect",
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    },
  ));
  expect(response.status).toBe(200);
  const body = await response.json();
  const state = new URL(body.authorizationUrl).searchParams.get("state");
  const binding = response.cookies.get("spotify_oauth")?.value;
  if (!state || !binding) throw new Error("Missing test transaction");

  cookieValues.set("spotify_oauth", binding);
  return state;
}

function callbackRequest(state: string) {
  const url = new URL("http://127.0.0.1:3000/api/spotify/callback");
  url.searchParams.set("state", state);
  url.searchParams.set("code", "test-only-authorization-code");
  return new Request(url);
}

async function cleanup(action: Action) {
  return action === "disconnect"
    ? disconnect(new Request(
        "http://127.0.0.1:3000/api/spotify/disconnect",
        { method: "DELETE", headers: { Origin: origin } },
      ))
    : deleteAccount(new Request(
        "http://127.0.0.1:3000/api/user/me",
        { method: "DELETE", headers: { Origin: origin } },
      ));
}

async function expectRemoved(action: Action, userId: string) {
  await expect(SpotifyConnection.countDocuments({ userId })).resolves.toBe(0);
  await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(0);

  if (action === "delete") {
    await expect(User.findById(userId)).resolves.toBeNull();
  } else {
    const user = await User.findById(userId).select("+spotifyLinkGeneration");
    expect(user?.spotifyLinkGeneration).toBe(1);
  }
}

describe("Actual cleanup routes during provider operations", () => {
  beforeAll(async () => {
    await User.init();
    await Favorite.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    cookieValues.clear();
    cookieGetMock.mockReset();
    cookieGetMock.mockImplementation((name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { name, value };
    });

    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("SPOTIFY_ENABLED", "true");
    vi.stubEnv("SPOTIFY_CLIENT_ID", "a".repeat(32));
    vi.stubEnv("SPOTIFY_FRONTEND_ORIGIN", origin);
    vi.stubEnv(
      "SPOTIFY_REDIRECT_URI",
      "http://127.0.0.1:3000/api/spotify/callback",
    );
    vi.stubEnv(
      "SPOTIFY_TOKEN_ENCRYPTION_KEYS",
      JSON.stringify({ test: Buffer.alloc(32, 1).toString("base64") }),
    );
    vi.stubEnv("SPOTIFY_TOKEN_ACTIVE_KEY_ID", "test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Unexpected provider request"),
    );
  });

  afterEach(() => {
    cookieValues.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["disconnect", "delete"] as const)(
    "%s cancels callback exchange and rejects a late token response",
    async action => {
      const userId = await authenticate();
      const state = await start();
      const pending = pendingResponse();
      let providerSignal: AbortSignal | undefined;

      vi.mocked(fetch).mockImplementation((_url, options) => {
        providerSignal = options?.signal ?? undefined;
        return pending.promise;
      });

      const finished = callback(callbackRequest(state));

      try {
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const response = await cleanup(action);
        expect(response.status).toBe(action === "disconnect" ? 204 : 200);
        expect(providerSignal?.aborted).toBe(true);

        const returned = await finished;
        expect(returned.status).toBe(303);
        expect(new URL(returned.headers.get("location") as string)
          .searchParams.get("spotify")).toBe("invalid_transaction");

        await expectRemoved(action, userId);
      } finally {
        pending.release(tokenResponse());
        await nextTurn();
      }

      // Even a transport that ignores abort cannot trigger the subsequent /me GET.
      expect(fetch).toHaveBeenCalledTimes(1);
      await expectRemoved(action, userId);
    },
  );

  it.each(["disconnect", "delete"] as const)(
    "%s cancels refresh and cannot be undone by a late refresh response",
    async action => {
      const userId = await authenticate();
      await seedConnection(userId, true);
      await start();
      const pending = pendingResponse();
      let providerSignal: AbortSignal | undefined;

      vi.mocked(fetch).mockImplementation((_url, options) => {
        providerSignal = options?.signal ?? undefined;
        return pending.promise;
      });

      const finished = Promise.allSettled([getSpotifyAccessToken({
        userId, generation: 0, config: enabledConfig(),
      })]);

      try {
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const response = await cleanup(action);
        expect(response.status).toBe(action === "disconnect" ? 204 : 200);
        expect(providerSignal?.aborted).toBe(true);

        const [result] = await finished;
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toMatchObject({ code: "connection_changed" });
        }
      } finally {
        pending.release(tokenResponse());
        await nextTurn();
      }

      expect(fetch).toHaveBeenCalledTimes(1);
      await expectRemoved(action, userId);
    },
  );

  it.each(["disconnect", "delete"] as const)(
    "%s cancels a profile read and discards its late success",
    async action => {
      const userId = await authenticate();
      await seedConnection(userId);
      const pending = pendingResponse();
      let providerSignal: AbortSignal | undefined;

      vi.mocked(fetch).mockImplementation((_url, options) => {
        providerSignal = options?.signal ?? undefined;
        return pending.promise;
      });

      const finished = Promise.allSettled([readSpotifyCurrentProfile({
        userId, generation: 0, config: enabledConfig(),
      })]);

      try {
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const response = await cleanup(action);
        expect(response.status).toBe(action === "disconnect" ? 204 : 200);
        expect(providerSignal?.aborted).toBe(true);

        const [result] = await finished;
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toMatchObject({ code: "connection_changed" });
        }
      } finally {
        pending.release(profileResponse());
        await nextTurn();
      }

      expect(fetch).toHaveBeenCalledTimes(1);
      await expectRemoved(action, userId);
    },
  );

  it("allows a new route-based reconnect while rejecting the old transaction", async () => {
    const userId = await authenticate();
    const oldState = await start();
    expect((await cleanup("disconnect")).status).toBe(204);
    const newState = await start();

    const rejected = await callback(callbackRequest(oldState));
    expect(new URL(rejected.headers.get("location") as string)
      .searchParams.get("spotify")).toBe("invalid_transaction");
    expect(fetch).not.toHaveBeenCalled();
    await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(1);

    vi.mocked(fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(profileResponse());

    const connected = await callback(callbackRequest(newState));
    expect(new URL(connected.headers.get("location") as string)
      .searchParams.get("spotify")).toBe("connected");

    const stored = await SpotifyConnection.findOne({ userId });
    expect(stored?.generation).toBe(1);
    expect(stored?.status).toBe("connected");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["disconnect", "delete"] as const)(
    "a failed %s route rolls back without cancelling an active refresh",
    async action => {
      const userId = await authenticate();
      await seedConnection(userId, true);
      await start();
      const pending = pendingResponse();
      let providerSignal: AbortSignal | undefined;

      vi.mocked(fetch).mockImplementation((_url, options) => {
        providerSignal = options?.signal ?? undefined;
        return pending.promise;
      });

      const finished = Promise.allSettled([getSpotifyAccessToken({
        userId, generation: 0, config: enabledConfig(),
      })]);

      try {
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

        if (action === "delete") {
          vi.spyOn(User, "deleteOne").mockImplementationOnce(() => {
            throw new Error("test-only-cleanup-failure");
          });
        } else {
          vi.spyOn(SpotifyOAuthTransaction, "deleteMany").mockImplementationOnce(() => {
            throw new Error("test-only-cleanup-failure");
          });
        }

        const response = await cleanup(action);
        expect(response.status).toBe(500);
        expect(response.headers.has("set-cookie")).toBe(false);
        expect(providerSignal?.aborted).toBe(false);
      } finally {
        pending.release(tokenResponse());
      }

      const [result] = await finished;
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(result.value.accessToken).toBe("test-only-new-access");
      }

      const user = await User.findById(userId).select("+spotifyLinkGeneration");
      expect(user?.spotifyLinkGeneration).toBe(0);
      const stored = await SpotifyConnection.findOne({ userId });
      expect(stored?.status).toBe("connected");
      expect(stored?.tokenVersion).toBe(1);
      await expect(SpotifyOAuthTransaction.countDocuments({ userId })).resolves.toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
