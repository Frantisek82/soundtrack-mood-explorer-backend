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

import { GET, OPTIONS } from "@/app/api/spotify/status/route";
import { generateToken } from "@/lib/jwt";
import SpotifyConnection from "@/models/SpotifyConnection";
import User from "@/models/User";

const origin = "http://127.0.0.1:3001";

function request(requestOrigin: string | null = origin) {
  const headers = new Headers();
  if (requestOrigin !== null) headers.set("Origin", requestOrigin);
  return new Request("http://127.0.0.1:3000/api/spotify/status", {
    headers,
  });
}

async function authenticate() {
  const user = await User.create({
    name: "Status User",
    email: "status-route@example.com",
    password: "test-only-password",
  });
  const token = generateToken({
    id: user._id.toString(),
    email: user.email,
  });
  cookieGetMock.mockReturnValue({ value: token });
  return user;
}

// Raw fixtures deliberately include private fields and can represent corrupt
// records. No real provider credentials or encryption keys are used.
async function connection(
  userId: unknown,
  status = "connected",
  generation = 0,
) {
  return SpotifyConnection.collection.insertOne({
    userId,
    accountId: "test-only-private-account",
    displayName: "Test Listener",
    status,
    generation,
    tokenVersion: 7,
    accessToken: { ciphertext: "test-only-private-access" },
    refreshToken: { ciphertext: "test-only-private-refresh" },
    refreshLeaseOwner: "test-only-private-owner",
    refreshLeaseExpiresAt: new Date("2000-01-01"),
    originalAuthorizedAt: new Date("2000-01-01"),
    estimatedRefreshExpiry: new Date("2000-07-01"),
    accessExpiresAt: new Date("2000-01-01"),
    grantedScopes: ["test-only-private-scope"],
  });
}

describe("Spotify status route", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
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

  it("returns disconnected when the user has no connection", async () => {
    await authenticate();
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "disconnected",
      account: null,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });

  it.each(["connected", "reauthorization_required"])(
    "returns only the public DTO for %s",
    async (state) => {
      const user = await authenticate();
      await connection(user._id, state);

      const response = await GET(request());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        state,
        account: { displayName: "Test Listener" },
      });
    },
  );

  it("reports an unavailable display name as null", async () => {
    const user = await authenticate();
    await connection(user._id);
    await SpotifyConnection.collection.updateOne(
      { userId: user._id },
      { $unset: { displayName: "" } },
    );

    await expect((await GET(request())).json()).resolves.toEqual({
      state: "connected",
      account: { displayName: null },
    });
  });

  it("does not refresh or mutate a record when repeatedly polled", async () => {
    const user = await authenticate();
    await connection(user._id);
    const before = await SpotifyConnection.collection.findOne({
      userId: user._id,
    });

    for (let index = 0; index < 3; index += 1) {
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect((await response.json()).state).toBe("connected");
    }

    const after = await SpotifyConnection.collection.findOne({
      userId: user._id,
    });
    expect(after).toEqual(before);
  });

  it("does not return another user's connection", async () => {
    const owner = await User.create({
      name: "Other User",
      email: "other-status@example.com",
      password: "test-only-password",
    });
    await connection(owner._id);
    await authenticate();

    await expect((await GET(request())).json()).resolves.toEqual({
      state: "disconnected",
      account: null,
    });
  });

  it("does not expose a connection from an invalidated generation", async () => {
    const user = await authenticate();
    await connection(user._id);
    await User.updateOne(
      { _id: user._id },
      { $set: { spotifyLinkGeneration: 1 } },
    );

    await expect((await GET(request())).json()).resolves.toEqual({
      state: "disconnected",
      account: null,
    });
  });

  it("rejects missing authentication", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      message: "Unauthorized",
    });
  });

  it("rejects invalid authentication", async () => {
    cookieGetMock.mockReturnValue({ value: "invalid-token" });
    expect((await GET(request())).status).toBe(401);
  });

  it("rejects expired authentication", async () => {
    const user = await authenticate();
    cookieGetMock.mockReturnValue({
      value: jwt.sign(
        { id: user._id.toString(), email: user.email },
        process.env.JWT_SECRET as string,
        { expiresIn: -1 },
      ),
    });
    expect((await GET(request())).status).toBe(401);
  });

  it("rejects authentication for a deleted User", async () => {
    const user = await authenticate();
    await connection(user._id);
    await User.deleteOne({ _id: user._id });
    expect((await GET(request())).status).toBe(401);
  });

  it.each([null, "null", "https://example.com", "http://localhost:3001"])(
    "rejects unapproved Origin %s",
    async (requestOrigin) => {
      const response = await GET(request(requestOrigin));
      expect(response.status).toBe(403);
      expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(cookieGetMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["SPOTIFY_ENABLED", "false"],
    ["VERCEL_ENV", "preview"],
    ["SPOTIFY_CLIENT_ID", ""],
  ])("returns unavailable for %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cookieGetMock).not.toHaveBeenCalled();
  });

  it("sanitizes database failures", async () => {
    await authenticate();
    vi.spyOn(SpotifyConnection, "findOne").mockImplementationOnce(() => {
      throw new Error("test-only-private-database-details");
    });

    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
  });

  it("sanitizes malformed persisted status without exposing private fields", async () => {
    const user = await authenticate();
    await connection(user._id, "invalid-private-state");

    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Internal server error",
    });
  });

  it("answers GET preflight without requiring authentication", async () => {
    const response = await OPTIONS(
      new Request("http://127.0.0.1:3000/api/spotify/status", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(cookieGetMock).not.toHaveBeenCalled();
  });
});
