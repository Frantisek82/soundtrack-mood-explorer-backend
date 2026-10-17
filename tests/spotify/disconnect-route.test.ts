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

import { DELETE, OPTIONS } from "@/app/api/spotify/disconnect/route";
import { generateToken } from "@/lib/jwt";
import { getSpotifyConfig } from "@/lib/spotify/config";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { createSpotifyOAuthTransaction } from "@/lib/spotify/transactions";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import User from "@/models/User";

const origin = "http://127.0.0.1:3001";

function request(requestOrigin: string | null = origin) {
  const headers = new Headers();
  if (requestOrigin !== null) headers.set("Origin", requestOrigin);
  return new Request("http://127.0.0.1:3000/api/spotify/disconnect", {
    method: "DELETE",
    headers,
  });
}

async function authenticate() {
  const user = await User.create({
    name: "Disconnect Route User",
    email: "disconnect-route@example.com",
    password: "test-only-password",
  });
  const token = generateToken({
    id: user._id.toString(),
    email: user.email,
  });
  cookieGetMock.mockReturnValue({ value: token });
  return { user, token };
}

async function linked() {
  const { user, token } = await authenticate();
  const config = getSpotifyConfig();
  if (!config.enabled) throw new Error("Expected enabled test configuration");

  const userId = user._id.toString();
  const time = Date.now();
  await persistSpotifyAccountLink({
    userId,
    generation: 0,
    config,
    authorization: {
      accountId: "test-only-disconnect-route-account",
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
      userId,
      generation: 0,
      sessionToken: token,
      config,
    });
  }
  return user;
}

describe("Spotify disconnect route", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    cookieGetMock.mockReset();
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
      new Error("Provider HTTP is forbidden during disconnect"),
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

  it("returns empty 204 after removing connection and pending transactions", async () => {
    const user = await linked();
    const response = await DELETE(request());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);

    const storedUser = await User.findById(user._id).select("+spotifyLinkGeneration");
    expect(storedUser?.spotifyLinkGeneration).toBe(1);
    expect(storedUser?.email).toBe(user.email);
    expect(response.cookies.get("token")).toBeUndefined();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("clears the local transaction cookie with matching attributes", async () => {
    await authenticate();
    const response = await DELETE(request());
    expect(response.status).toBe(204);

    const cookie = response.cookies.get("spotify_oauth");
    expect(cookie?.value).toBe("");
    expect(cookie?.path).toBe("/api/spotify");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.domain).toBeUndefined();

    const header = response.headers.get("set-cookie")?.toLowerCase() ?? "";
    expect(header).toContain("expires=thu, 01 jan 1970 00:00:00 gmt");
    expect(header).not.toContain("; secure");
  });

  it("clears the HTTPS transaction cookie with Secure", async () => {
    const productionOrigin =
      "https://soundtrack-mood-explorer-frontend.vercel.app";
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SPOTIFY_FRONTEND_ORIGIN", productionOrigin);
    vi.stubEnv(
      "SPOTIFY_REDIRECT_URI",
      "https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback",
    );
    await authenticate();

    const response = await DELETE(request(productionOrigin));
    expect(response.status).toBe(204);
    expect(response.cookies.get("spotify_oauth")?.secure).toBe(true);
    expect(response.cookies.get("spotify_oauth")?.path).toBe("/api/spotify");
  });

  it("keeps repeated disconnects successful", async () => {
    await linked();
    expect((await DELETE(request())).status).toBe(204);
    expect((await DELETE(request())).status).toBe(204);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it("allows an authenticated user with no previous Spotify link", async () => {
    await authenticate();
    expect((await DELETE(request())).status).toBe(204);
  });

  it("rejects missing authentication", async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(401);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("rejects invalid authentication", async () => {
    cookieGetMock.mockReturnValue({ value: "invalid-token" });
    expect((await DELETE(request())).status).toBe(401);
  });

  it("rejects expired authentication", async () => {
    const { user } = await authenticate();
    cookieGetMock.mockReturnValue({
      value: jwt.sign(
        { id: user._id.toString(), email: user.email },
        process.env.JWT_SECRET as string,
        { expiresIn: -1 },
      ),
    });
    expect((await DELETE(request())).status).toBe(401);
  });

  it("rejects a signed session for a deleted User", async () => {
    const user = await linked();
    await User.deleteOne({ _id: user._id });
    const response = await DELETE(request());

    expect(response.status).toBe(401);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(1);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it.each([
    null,
    "null",
    "http://localhost:3001",
    "https://example.com",
    "https://soundtrack-mood-explorer-frontend-git-feature.vercel.app",
    "https://soundtrack-mood-explorer-frontend.vercel.app.evil.test",
  ])("rejects unapproved Origin %s without cleanup", async requestOrigin => {
    const user = await linked();
    const response = await DELETE(request(requestOrigin));

    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(cookieGetMock).not.toHaveBeenCalled();
    await expect(SpotifyConnection.countDocuments({ userId: user._id })).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments({ userId: user._id })).resolves.toBe(2);
  });

  it.each([
    ["SPOTIFY_ENABLED", "false"],
    ["VERCEL_ENV", "preview"],
    ["SPOTIFY_CLIENT_ID", ""],
  ])("returns unavailable for %s=%s without cleanup", async (name, value) => {
    await linked();
    vi.stubEnv(name, value);
    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(2);
  });

  it("returns sanitized 500 and rolls back cleanup on database failure", async () => {
    const user = await linked();
    vi.spyOn(SpotifyOAuthTransaction, "deleteMany").mockImplementationOnce(() => {
      throw new Error("test-only-private-cleanup-details");
    });

    const response = await DELETE(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
    expect(response.headers.has("set-cookie")).toBe(false);

    await expect(SpotifyConnection.countDocuments()).resolves.toBe(1);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(2);
    const storedUser = await User.findById(user._id).select("+spotifyLinkGeneration");
    expect(storedUser?.spotifyLinkGeneration).toBe(0);
  });

  it("answers DELETE preflight without authentication or cleanup", async () => {
    const response = await OPTIONS(new Request(
      "http://127.0.0.1:3000/api/spotify/disconnect",
      {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "DELETE",
        },
      },
    ));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cookieGetMock).not.toHaveBeenCalled();
    expect(response.headers.has("set-cookie")).toBe(false);
  });
});
