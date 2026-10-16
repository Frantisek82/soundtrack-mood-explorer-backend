import jwt from "jsonwebtoken";
import mongoose from "mongoose";
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

import { OPTIONS, POST } from "@/app/api/spotify/connect/route";
import { generateToken } from "@/lib/jwt";
import * as readiness from "@/lib/spotify/readiness";
import User from "@/models/User";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";

const origin = "http://127.0.0.1:3001";

function request(
  requestOrigin: string | null = origin,
  contentType = "application/json",
) {
  const headers = new Headers({ "Content-Type": contentType });
  if (requestOrigin !== null) headers.set("Origin", requestOrigin);

  return new Request("http://127.0.0.1:3000/api/spotify/connect", {
    method: "POST",
    headers,
    body: JSON.stringify({
      userId: "ignored-client-user-id",
      redirectUri: "https://example.com",
    }),
  });
}

async function authenticate() {
  const user = await User.create({
    name: "Spotify Connect User",
    email: "connect-route@example.com",
    password: "test-only-password",
  });

  const token = generateToken({
    id: user._id.toString(),
    email: user.email,
  });
  cookieGetMock.mockReturnValue({ name: "token", value: token });
  return user;
}

describe("Spotify connect route", () => {
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
      new Error("Live provider HTTP is forbidden"),
    );
  });

  afterEach(() => {
    try {
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it("starts a session-owned transaction and returns only its authorization URL", async () => {
    const user = await authenticate();
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(["authorizationUrl"]);

    const url = new URL(body.authorizationUrl);
    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/spotify/callback",
    );

    const transaction = await SpotifyOAuthTransaction.findOne().lean();
    expect(transaction?.userId.toString()).toBe(user._id.toString());
    expect(transaction?.generation).toBe(0);

    const binding = response.cookies.get("spotify_oauth");
    expect(binding?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(body)).not.toContain(binding?.value);
    expect(response.cookies.get("token")).toBeUndefined();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects missing authentication", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it("rejects invalid authentication", async () => {
    cookieGetMock.mockReturnValue({ value: "invalid-token" });
    expect((await POST(request())).status).toBe(401);
  });

  it("rejects expired authentication", async () => {
    cookieGetMock.mockReturnValue({
      value: jwt.sign(
        {
          id: new mongoose.Types.ObjectId().toString(),
          email: "test@example.com",
        },
        process.env.JWT_SECRET as string,
        { expiresIn: -1 },
      ),
    });
    expect((await POST(request())).status).toBe(401);
  });

  it("rejects a signed token for a deleted User", async () => {
    const user = await authenticate();
    await User.deleteOne({ _id: user._id });

    expect((await POST(request())).status).toBe(401);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it.each([
    null,
    "null",
    "https://example.com",
    "https://soundtrack-mood-explorer-frontend-git-feature.vercel.app",
    "https://soundtrack-mood-explorer-frontend.vercel.app.evil.test",
  ])("rejects unapproved Origin %s", async (requestOrigin) => {
    const response = await POST(request(requestOrigin));
    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("rejects a non-JSON media type", async () => {
    expect((await POST(request(origin, "text/plain"))).status).toBe(415);
  });

  it.each([
    ["SPOTIFY_ENABLED", "false"],
    ["VERCEL_ENV", "preview"],
    ["SPOTIFY_CLIENT_ID", ""],
  ])("returns unavailable for %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it("fails closed when persistence is not ready", async () => {
    await authenticate();
    vi.spyOn(readiness, "assertSpotifyPersistenceReady").mockRejectedValue(
      new Error("test-only-private-database-details"),
    );

    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      message: "Spotify connection unavailable",
    });
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });

  it("answers approved preflight without authentication or creating a transaction", async () => {
    const response = await OPTIONS(
      new Request("http://127.0.0.1:3000/api/spotify/connect", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
    expect(cookieGetMock).not.toHaveBeenCalled();
    await expect(SpotifyOAuthTransaction.countDocuments()).resolves.toBe(0);
  });
});
