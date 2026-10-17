import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SpotifyConfig } from "@/lib/spotify/config";
import { invalidateSpotifyLinkGeneration } from "@/lib/spotify/generation";
import { persistSpotifyAccountLink } from "@/lib/spotify/link";
import { readSpotifyCurrentProfile } from "@/lib/spotify/read-profile";
import SpotifyConnection from "@/models/SpotifyConnection";
import User from "@/models/User";

const config: Extract<SpotifyConfig, { enabled: true }> = {
  enabled: true,
  clientId: "a".repeat(32),
  frontendOrigin: "http://127.0.0.1:3001",
  redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
  encryptionKeys: new Map([["test", Buffer.alloc(32, 1)]]),
  activeKeyId: "test",
};

const instant = new Date("2026-10-16T12:00:00.000Z");
const now = () => new Date(instant);

function profile(extra = {}) {
  return Response.json({
    account_id: "test-only-read-account",
    display_name: "Test Listener",
    email: "private@example.com",
    id: "test-only-private-provider-id",
    ...extra,
  });
}

function tokens() {
  return Response.json({
    access_token: "test-only-new-access",
    token_type: "Bearer",
    expires_in: 3600,
  });
}

async function fixture(expired = false) {
  const user = await User.create({
    name: "Read User",
    email: "read-profile@example.com",
    password: "test-only-password",
  });
  const userId = user._id.toString();

  await persistSpotifyAccountLink({
    userId,
    generation: 0,
    config,
    authorization: {
      accountId: "test-only-read-account",
      displayName: "Test Listener",
      accessToken: "test-only-old-access",
      refreshToken: "test-only-refresh",
      grantedScopes: [],
      authorizedAt: new Date(instant.getTime() - 3_600_000),
      accessExpiresAt: new Date(instant.getTime() + (expired ? 0 : 3_600_000)),
    },
  });

  return { userId, generation: 0, config, now };
}

function methods() {
  return vi.mocked(fetch).mock.calls.map(([, options]) => options?.method);
}

describe("Bounded Spotify profile reads", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Unexpected provider request"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a fixed GET and returns only the normalized display name", async () => {
    const input = await fixture();
    vi.mocked(fetch).mockResolvedValue(profile());

    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: "Test Listener",
    });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.spotify.com/v1/me");
    expect(options?.method).toBe("GET");
    expect(options?.redirect).toBe("error");
    expect(options?.cache).toBe("no-store");
    expect(new Headers(options?.headers).get("Authorization"))
      .toBe("Bearer test-only-old-access");
  });

  it("accepts an unavailable display name", async () => {
    const input = await fixture();
    vi.mocked(fetch).mockResolvedValue(profile({ display_name: null }));
    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: null,
    });
  });

  it("refreshes once after 401 and retries the GET once", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(profile());

    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: "Test Listener",
    });
    expect(methods()).toEqual(["GET", "POST", "GET"]);
    expect(new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers)
      .get("Authorization")).toBe("Bearer test-only-new-access");
  });

  it("requires reauthorization after persistent 401 without another refresh", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "reauthorization_required",
    });
    expect(methods()).toEqual(["GET", "POST", "GET"]);
    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.status).toBe("reauthorization_required");
    expect(stored?.accessToken).toBeUndefined();
    expect(stored?.refreshToken).toBeUndefined();
  });

  it("does not refresh again when a freshly acquired token gets 401", async () => {
    const input = await fixture(true);
    vi.mocked(fetch)
      .mockResolvedValueOnce(tokens())
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "reauthorization_required",
    });
    expect(methods()).toEqual(["POST", "GET"]);
  });

  it("does not refresh, retry or disconnect after 403", async () => {
    const input = await fixture();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }));

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "access_restricted",
    });
    expect(methods()).toEqual(["GET"]);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it("honors a zero-second Retry-After with only one GET retry", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, {
        status: 429, headers: { "Retry-After": "0" },
      }))
      .mockResolvedValueOnce(profile());

    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: "Test Listener",
    });
    expect(methods()).toEqual(["GET", "GET"]);
  });

  it("does not wait beyond the operation budget for a 429", async () => {
    const input = await fixture();
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 429, headers: { "Retry-After": "120" },
    }));

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "rate_limited", retryAfterSeconds: 120,
    });
    expect(methods()).toEqual(["GET"]);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it.each([null, "-1", "invalid"])(
    "does not guess a retry delay for Retry-After %s",
    async header => {
      const input = await fixture();
      const headers = new Headers();
      if (header !== null) headers.set("Retry-After", header);
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429, headers }));

      await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
        code: "rate_limited",
      });
      expect(methods()).toEqual(["GET"]);
    },
  );

  it("retries a transient GET failure once with no refresh", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(profile());

    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: "Test Listener",
    });
    expect(methods()).toEqual(["GET", "GET"]);
  });

  it("stops after two failed GETs and preserves connection state", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "provider_error",
    });
    expect(methods()).toEqual(["GET", "GET"]);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it("allows only one safe GET retry after a network failure", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("test-only-private-network-details"))
      .mockResolvedValueOnce(profile());

    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: "Test Listener",
    });
    expect(methods()).toEqual(["GET", "GET"]);
  });

  it.each([
    { account_id: null },
    { account_id: "different-account" },
    { display_name: 42 },
    { display_name: "x".repeat(257) },
  ])("rejects malformed identity without retrying or changing the connection", async patch => {
    const input = await fixture();
    vi.mocked(fetch).mockResolvedValue(profile(patch));

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "invalid_response",
      message: "Spotify read request failed",
    });
    expect(methods()).toEqual(["GET"]);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it.each(["not-json", "x".repeat(65_537)])(
    "rejects malformed or oversized response bodies without retry",
    async body => {
      const input = await fixture();
      vi.mocked(fetch).mockResolvedValue(new Response(body));
      await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
        code: "invalid_response",
      });
      expect(methods()).toEqual(["GET"]);
    },
  );

  it("does not dispatch another GET after disconnect during a failed read", async () => {
    const input = await fixture();
    vi.mocked(fetch).mockImplementation(async () => {
      await invalidateSpotifyLinkGeneration(input.userId, async session => {
        await SpotifyConnection.deleteMany({ userId: input.userId }).session(session);
      });
      return new Response(null, { status: 503 });
    });

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "connection_changed",
    });
    expect(methods()).toEqual(["GET"]);
    await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
  });

  it("does not turn a transient failure followed by 401 into extra attempts", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "provider_error",
    });
    expect(methods()).toEqual(["GET", "GET"]);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it("stops an aborted operation without contacting Spotify", async () => {
    const input = await fixture();
    const controller = new AbortController();
    controller.abort();

    await expect(readSpotifyCurrentProfile({
      ...input, signal: controller.signal,
    })).rejects.toMatchObject({ code: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Spotify read races and time budgets", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyConnection.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Unexpected provider request"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["disconnect", "delete"])(
    "discards a successful response after %s during HTTP",
    async action => {
      const input = await fixture();
      vi.mocked(fetch).mockImplementation(async () => {
        await invalidateSpotifyLinkGeneration(input.userId, async session => {
          await SpotifyConnection.deleteMany({ userId: input.userId }).session(session);
          if (action === "delete") {
            await User.deleteOne({ _id: input.userId }).session(session);
          }
        });
        return profile();
      });

      await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
        code: "connection_changed",
      });
      expect(methods()).toEqual(["GET"]);
      await expect(SpotifyConnection.countDocuments()).resolves.toBe(0);
    },
  );

  it("discards a successful response from a superseded token version", async () => {
    const input = await fixture();
    vi.mocked(fetch).mockImplementation(async () => {
      await persistSpotifyAccountLink({
        ...input,
        authorization: {
          accountId: "test-only-read-account",
          displayName: "Updated Listener",
          accessToken: "test-only-reauthorized-access",
          refreshToken: "test-only-reauthorized-refresh",
          grantedScopes: [],
          authorizedAt: now(),
          accessExpiresAt: new Date(instant.getTime() + 3_600_000),
        },
      });
      return profile();
    });

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "connection_changed",
    });
    expect(methods()).toEqual(["GET"]);
    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.status).toBe("connected");
    expect(stored?.tokenVersion).toBe(1);
    expect(stored?.displayName).toBe("Updated Listener");
  });

  it("does not let a late 401 invalidate a newer reauthorization", async () => {
    const input = await fixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(tokens())
      .mockImplementationOnce(async () => {
        await persistSpotifyAccountLink({
          ...input,
          authorization: {
            accountId: "test-only-read-account",
            displayName: "Updated Listener",
            accessToken: "test-only-reauthorized-access",
            refreshToken: "test-only-reauthorized-refresh",
            grantedScopes: [],
            authorizedAt: now(),
            accessExpiresAt: new Date(instant.getTime() + 3_600_000),
          },
        });
        return new Response(null, { status: 401 });
      });

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      code: "connection_changed",
    });
    expect(methods()).toEqual(["GET", "POST", "GET"]);
    const stored = await SpotifyConnection.collection.findOne({});
    expect(stored?.status).toBe("connected");
    expect(stored?.tokenVersion).toBe(2);
  });

  it("allows one GET retry after a per-call timeout", async () => {
    const input = await fixture();
    const controller = new AbortController();
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    let providedTimeout = false;

    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      if (milliseconds === 10_000 && !providedTimeout) {
        providedTimeout = true;
        return controller.signal;
      }
      return originalTimeout(milliseconds);
    });

    vi.mocked(fetch)
      .mockImplementationOnce(() => {
        controller.abort();
        return new Promise<Response>(() => {});
      })
      .mockResolvedValueOnce(profile());

    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: "Test Listener",
    });
    expect(providedTimeout).toBe(true);
    expect(methods()).toEqual(["GET", "GET"]);
  });

  it("does not retry after the overall operation budget expires", async () => {
    const input = await fixture();
    const controller = new AbortController();
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);

    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds =>
      milliseconds === 20_000
        ? controller.signal
        : originalTimeout(milliseconds),
    );
    vi.mocked(fetch).mockImplementation(() => {
      controller.abort();
      return new Promise<Response>(() => {});
    });

    await expect(readSpotifyCurrentProfile(input)).rejects.toMatchObject({
      message: "Spotify read request failed",
    });
    expect(methods()).toEqual(["GET"]);
    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });

  it("waits for a positive Retry-After before its sole retry", async () => {
    const input = await fixture();
    let firstRequestAt = 0;
    let secondRequestAt = 0;

    vi.mocked(fetch)
      .mockImplementationOnce(async () => {
        firstRequestAt = performance.now();
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      })
      .mockImplementationOnce(async () => {
        secondRequestAt = performance.now();
        return profile();
      });

    await expect(readSpotifyCurrentProfile(input)).resolves.toEqual({
      displayName: "Test Listener",
    });
    expect(secondRequestAt - firstRequestAt).toBeGreaterThanOrEqual(1000);
    expect(methods()).toEqual(["GET", "GET"]);
  });

  it("cancels a Retry-After wait without another provider request", async () => {
    const input = await fixture();
    const controller = new AbortController();
    let abortTimer: ReturnType<typeof setTimeout> | undefined;

    vi.mocked(fetch).mockImplementation(async () => {
      abortTimer = setTimeout(() => controller.abort(), 10);
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "1" },
      });
    });

    try {
      await expect(readSpotifyCurrentProfile({
        ...input, signal: controller.signal,
      })).rejects.toMatchObject({
        message: "Spotify read request failed",
      });
      expect(methods()).toEqual(["GET"]);
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
    }

    expect((await SpotifyConnection.collection.findOne({}))?.status).toBe("connected");
  });
});
