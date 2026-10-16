import jwt from "jsonwebtoken";
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

import { GET } from "@/app/api/spotify/callback/route";
import { POST } from "@/app/api/spotify/connect/route";
import { generateToken } from "@/lib/jwt";
import { getSpotifyConfig } from "@/lib/spotify/config";
import { invalidateSpotifyLinkGeneration } from "@/lib/spotify/generation";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import User from "@/models/User";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";

const fetchMock = vi.fn<typeof fetch>();

const tokenResponse = {
  access_token: "test-only-access",
  refresh_token: "test-only-refresh",
  token_type: "Bearer",
  expires_in: 3600,
  scope: "",
};

const profileResponse = {
  account_id: "stable-test-account",
  display_name: "Test Listener",
};

function providerSuccess() {
  fetchMock
    .mockResolvedValueOnce(Response.json(tokenResponse))
    .mockResolvedValueOnce(Response.json(profileResponse));
}

async function fixture() {
  const user = await User.create({
    name: "Callback User",
    email: "callback@example.com",
    password: "test-only-password",
  });

  let currentToken: string | undefined = generateToken({
    id: user._id.toString(),
    email: user.email,
  });
  let binding: string | undefined;

  cookieGetMock.mockImplementation((name: string) => {
    const value =
      name === "token"
        ? currentToken
        : name === "spotify_oauth"
          ? binding
          : undefined;
    return value === undefined ? undefined : { name, value };
  });

  const start = await POST(
    new Request("http://127.0.0.1:3000/api/spotify/connect", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3001",
        "Content-Type": "application/json",
      },
    }),
  );
  if (start.status !== 200) throw new Error("Could not start test transaction");

  const body = await start.json();
  const authorizationUrl = new URL(body.authorizationUrl);
  binding = start.cookies.get("spotify_oauth")?.value;

  const state = authorizationUrl.searchParams.get("state");
  if (!state || !binding) throw new Error("Missing test transaction binding");

  const url = new URL("http://127.0.0.1:3000/api/spotify/callback");
  url.searchParams.set("state", state);
  url.searchParams.set("code", "test-only-code");

  const config = getSpotifyConfig();
  if (!config.enabled) throw new Error("Expected enabled configuration");

  return {
    userId: user._id.toString(),
    url,
    config,
    setToken(value: string | undefined) {
      currentToken = value;
    },
    setBinding(value: string | undefined) {
      binding = value;
    },
  };
}

function callback(url: URL) {
  return GET(new Request(url));
}

function expectResult(
  response: Awaited<ReturnType<typeof GET>>,
  result: string,
) {
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe(
    `http://127.0.0.1:3001/profile?spotify=${result}`,
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.cookies.get("spotify_oauth")?.value).toBe("");
  expect(response.cookies.get("token")).toBeUndefined();
}

describe("Spotify callback route", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    cookieGetMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("Unexpected provider request"));
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("SPOTIFY_ENABLED", "true");
    vi.stubEnv("SPOTIFY_CLIENT_ID", "a".repeat(32));
    vi.stubEnv("SPOTIFY_FRONTEND_ORIGIN", "http://127.0.0.1:3001");
    vi.stubEnv(
      "SPOTIFY_REDIRECT_URI",
      "http://127.0.0.1:3000/api/spotify/callback",
    );
    vi.stubEnv(
      "SPOTIFY_TOKEN_ENCRYPTION_KEYS",
      JSON.stringify({ test: Buffer.alloc(32, 1).toString("base64") }),
    );
    vi.stubEnv("SPOTIFY_TOKEN_ACTIVE_KEY_ID", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("connects after a valid callback and consumes its transaction", async () => {
    const data = await fixture();
    providerSuccess();

    expectResult(await callback(data.url), "connected");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const connection = await SpotifyConnection.findOne({
      userId: data.userId,
    }).lean();
    expect(connection).toMatchObject({
      accountId: "stable-test-account",
      status: "connected",
      generation: 0,
    });
    expect(connection).not.toHaveProperty("accessToken");
    expect(connection).not.toHaveProperty("refreshToken");
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it("consumes validated denial without contacting Spotify", async () => {
    const data = await fixture();
    data.url.searchParams.delete("code");
    data.url.searchParams.set("error", "access_denied");

    expectResult(await callback(data.url), "denied");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("validates provider-error callbacks without exchanging a code", async () => {
    const data = await fixture();
    data.url.searchParams.delete("code");
    data.url.searchParams.set("error", "server_error");

    expectResult(await callback(data.url), "provider_error");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it("rejects duplicate parameters before consumption", async () => {
    const data = await fixture();
    data.url.searchParams.append("state", "duplicate");

    expectResult(await callback(data.url), "invalid_transaction");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(1);
  });

  it("rejects mismatched state", async () => {
    const data = await fixture();
    data.url.searchParams.set(
      "state",
      Buffer.alloc(32, 2).toString("base64url"),
    );

    expectResult(await callback(data.url), "invalid_transaction");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, Buffer.alloc(32, 2).toString("base64url")])(
    "rejects a missing or mismatched browser binding",
    async (binding) => {
      const data = await fixture();
      data.setBinding(binding);

      expectResult(await callback(data.url), "invalid_transaction");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a replaced valid application session", async () => {
    const data = await fixture();
    data.setToken(
      jwt.sign(
        { id: data.userId, email: "callback@example.com" },
        process.env.JWT_SECRET as string,
        { expiresIn: "6d" },
      ),
    );

    expectResult(await callback(data.url), "invalid_transaction");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects expired application authentication", async () => {
    const data = await fixture();
    data.setToken(
      jwt.sign(
        { id: data.userId, email: "callback@example.com" },
        process.env.JWT_SECRET as string,
        { expiresIn: -1 },
      ),
    );

    expectResult(await callback(data.url), "session_expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a callback for a deleted application User", async () => {
    const data = await fixture();
    await User.deleteOne({ _id: data.userId });

    expectResult(await callback(data.url), "session_expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects expired OAuth transactions before provider requests", async () => {
    const data = await fixture();
    await SpotifyOAuthTransaction.updateOne(
      { userId: data.userId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    expectResult(await callback(data.url), "invalid_transaction");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects replay without another code exchange", async () => {
    const data = await fixture();
    providerSuccess();

    expectResult(await callback(data.url), "connected");
    expectResult(await callback(data.url), "invalid_transaction");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows only one concurrent callback to exchange a code", async () => {
    const data = await fixture();
    providerSuccess();

    const responses = await Promise.all([
      callback(data.url),
      callback(data.url),
    ]);

    const results = responses
      .map((response) =>
        new URL(response.headers.get("Location")!).searchParams.get("spotify"),
      )
      .sort();

    expect(results).toEqual(["connected", "invalid_transaction"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(1);
  });

  it("preserves an existing link after a failed code exchange", async () => {
    const data = await fixture();
    await persistSpotifyAccountLink({
      userId: data.userId,
      generation: 0,
      config: data.config,
      authorization: {
        accountId: "previous-account",
        displayName: "Previous Listener",
        accessToken: "previous-test-access",
        refreshToken: "previous-test-refresh",
        grantedScopes: [],
        authorizedAt: new Date(),
        accessExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const before = await SpotifyConnection.findOne({ userId: data.userId })
      .select("+accessToken +refreshToken")
      .lean();

    fetchMock.mockResolvedValueOnce(
      new Response("test-only-private-error", { status: 400 }),
    );

    expectResult(await callback(data.url), "provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const after = await SpotifyConnection.findOne({ userId: data.userId })
      .select("+accessToken +refreshToken")
      .lean();
    expect(after).toEqual(before);
  });

  it("does not restore a link invalidated while provider HTTP is in flight", async () => {
    const data = await fixture();
    fetchMock
      .mockResolvedValueOnce(Response.json(tokenResponse))
      .mockImplementationOnce(async () => {
        await invalidateSpotifyLinkGeneration(data.userId, async (session) => {
          await SpotifyConnection.deleteMany(
            { userId: data.userId },
            { session },
          );
        });
        return Response.json(profileResponse);
      });

    expectResult(await callback(data.url), "invalid_transaction");
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("does not restore a User deleted while provider HTTP is in flight", async () => {
    const data = await fixture();
    fetchMock
      .mockResolvedValueOnce(Response.json(tokenResponse))
      .mockImplementationOnce(async () => {
        await invalidateSpotifyLinkGeneration(data.userId, async (session) => {
          await SpotifyConnection.deleteMany(
            { userId: data.userId },
            { session },
          );
          await User.deleteOne({ _id: data.userId }, { session });
        });
        return Response.json(profileResponse);
      });

    expectResult(await callback(data.url), "session_expired");
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("returns unavailable on preview deployments", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    const response = await GET(
      new Request("http://127.0.0.1:3000/api/spotify/callback"),
    );
    expect(response.status).toBe(503);
    expect(response.headers.has("Location")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid-token"])(
    "rejects missing or invalid application authentication",
    async (token) => {
      const data = await fixture();
      data.setToken(token);

      expectResult(await callback(data.url), "session_expired");
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    },
  );

  it("rejects a different signed-in application user before provider requests", async () => {
    const data = await fixture();
    const other = await User.create({
      name: "Other Callback User",
      email: "other-callback@example.com",
      password: "test-only-password",
    });
    data.setToken(
      generateToken({
        id: other._id.toString(),
        email: other.email,
      }),
    );

    expectResult(await callback(data.url), "invalid_transaction");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("rejects a tampered encrypted verifier without contacting Spotify", async () => {
    const data = await fixture();
    await SpotifyOAuthTransaction.updateOne(
      { userId: data.userId },
      { $set: { "verifier.tag": Buffer.alloc(16, 9).toString("base64") } },
    );

    expectResult(await callback(data.url), "provider_error");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("rejects authentication that expires during provider requests", async () => {
    const data = await fixture();
    fetchMock
      .mockResolvedValueOnce(Response.json(tokenResponse))
      .mockImplementationOnce(async () => {
        data.setToken(
          jwt.sign(
            { id: data.userId, email: "callback@example.com" },
            process.env.JWT_SECRET as string,
            { expiresIn: -1 },
          ),
        );
        return Response.json(profileResponse);
      });

    expectResult(await callback(data.url), "session_expired");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("returns account_conflict and preserves an existing different-account link", async () => {
    const data = await fixture();
    await persistSpotifyAccountLink({
      userId: data.userId,
      generation: 0,
      config: data.config,
      authorization: {
        accountId: "previous-account",
        displayName: "Previous Listener",
        accessToken: "previous-test-access",
        refreshToken: "previous-test-refresh",
        grantedScopes: [],
        authorizedAt: new Date(),
        accessExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const before = await SpotifyConnection.findOne({ userId: data.userId })
      .select("+accessToken +refreshToken")
      .lean();

    providerSuccess();
    expectResult(await callback(data.url), "account_conflict");

    const after = await SpotifyConnection.findOne({ userId: data.userId })
      .select("+accessToken +refreshToken")
      .lean();
    expect(after).toEqual(before);
  });
});
