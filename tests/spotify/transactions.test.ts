import { createHash } from "node:crypto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getSpotifyConfig } from "@/lib/spotify/config";
import { decryptSpotifyCredential } from "@/lib/spotify/encryption";
import { invalidateSpotifyLinkGeneration } from "@/lib/spotify/generation";
import {
  consumeSpotifyOAuthTransaction,
  createSpotifyOAuthTransaction,
  SpotifyOAuthTransactionError,
} from "@/lib/spotify/transactions";
import User from "@/models/User";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";

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

async function fixture() {
  const user = await User.create({
    name: "OAuth Transaction User",
    email: "oauth-transaction@example.com",
    password: "test-only-password",
  });
  const startedAt = new Date();
  const context = {
    userId: user._id.toString(),
    generation: 0,
    sessionToken: "test-only-verified-application-session",
    config: configuration(),
    now: () => startedAt,
  };
  const started = await createSpotifyOAuthTransaction(context);
  const url = new URL(started.authorizationUrl);
  const state = url.searchParams.get("state");
  if (!state) throw new Error("Missing authorization state");

  return {
    context,
    started,
    url,
    startedAt,
    consumeInput: {
      ...context,
      state,
      browserBinding: started.browserBinding,
    },
  };
}

describe("Spotify OAuth transactions", () => {
  beforeAll(async () => {
    await User.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Live HTTP is forbidden in transaction tests"),
    );
  });

  afterEach(() => {
    try {
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("constructs minimal-scope S256 authorization bound to the stored verifier", async () => {
    const data = await fixture();

    expect(data.url.origin).toBe("https://accounts.spotify.com");
    expect(data.url.pathname).toBe("/authorize");
    expect(data.url.searchParams.get("response_type")).toBe("code");
    expect(data.url.searchParams.get("client_id")).toBe(
      data.context.config.clientId,
    );
    expect(data.url.searchParams.get("redirect_uri")).toBe(
      data.context.config.redirectUri,
    );
    expect(data.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(data.url.searchParams.has("scope")).toBe(false);
    expect(data.consumeInput.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.started.browserBinding).not.toBe(data.consumeInput.state);

    const consumed = await consumeSpotifyOAuthTransaction(data.consumeInput);
    const verifier = decryptSpotifyCredential(
      consumed.encryptedVerifier,
      {
        userId: data.context.userId,
        generation: 0,
        purpose: "pkce_verifier",
      },
      data.context.config,
    );

    expect(data.url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
  });

  it("stores hashes rather than raw state, binding, or application session", async () => {
    const data = await fixture();
    const stored = await SpotifyOAuthTransaction.findOne({
      userId: data.context.userId,
    })
      .select("+stateHash +browserBindingHash +sessionHash +verifier")
      .lean();

    expect(stored?.stateHash).toBe(
      createHash("sha256").update(data.consumeInput.state).digest("hex"),
    );
    expect(stored?.expiresAt.getTime()).toBe(
      data.startedAt.getTime() + 600_000,
    );

    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(data.consumeInput.state);
    expect(serialized).not.toContain(data.started.browserBinding);
    expect(serialized).not.toContain(data.context.sessionToken);
  });

  it.each(["state", "browserBinding", "sessionToken"] as const)(
    "rejects a mismatched %s without consuming the valid transaction",
    async (field) => {
      const data = await fixture();
      const wrong =
        field === "sessionToken"
          ? "different-test-session"
          : Buffer.alloc(32, 2).toString("base64url");

      await expect(
        consumeSpotifyOAuthTransaction({
          ...data.consumeInput,
          [field]: wrong,
        }),
      ).rejects.toBeInstanceOf(SpotifyOAuthTransactionError);

      await expect(
        consumeSpotifyOAuthTransaction(data.consumeInput),
      ).resolves.toHaveProperty("encryptedVerifier");
    },
  );

  it("rejects a different application user", async () => {
    const data = await fixture();
    const other = await User.create({
      name: "Other User",
      email: "other-oauth-user@example.com",
      password: "test-only-password",
    });

    await expect(
      consumeSpotifyOAuthTransaction({
        ...data.consumeInput,
        userId: other._id.toString(),
      }),
    ).rejects.toBeInstanceOf(SpotifyOAuthTransactionError);
  });

  it("rejects expiry at the exact boundary even before TTL cleanup", async () => {
    const data = await fixture();

    await expect(
      consumeSpotifyOAuthTransaction({
        ...data.consumeInput,
        now: () => new Date(data.startedAt.getTime() + 600_000),
      }),
    ).rejects.toBeInstanceOf(SpotifyOAuthTransactionError);

    await expect(
      SpotifyOAuthTransaction.countDocuments({
        userId: data.context.userId,
      }),
    ).resolves.toBe(1);
  });

  it("rejects sequential callback replay", async () => {
    const data = await fixture();
    await consumeSpotifyOAuthTransaction(data.consumeInput);

    await expect(
      consumeSpotifyOAuthTransaction(data.consumeInput),
    ).rejects.toBeInstanceOf(SpotifyOAuthTransactionError);
  });

  it("allows exactly one concurrent consumer", async () => {
    const data = await fixture();
    const results = await Promise.allSettled([
      consumeSpotifyOAuthTransaction(data.consumeInput),
      consumeSpotifyOAuthTransaction(data.consumeInput),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(SpotifyOAuthTransactionError);

    await expect(
      SpotifyOAuthTransaction.countDocuments({
        userId: data.context.userId,
      }),
    ).resolves.toBe(0);
  });

  it("rejects a transaction after link-generation invalidation", async () => {
    const data = await fixture();
    await invalidateSpotifyLinkGeneration(
      data.context.userId,
      async () => undefined,
    );

    await expect(
      consumeSpotifyOAuthTransaction(data.consumeInput),
    ).rejects.toBeInstanceOf(SpotifyOAuthTransactionError);
  });

  it("rejects a transaction whose application user was deleted", async () => {
    const data = await fixture();
    await User.deleteOne({ _id: data.context.userId });

    await expect(
      consumeSpotifyOAuthTransaction(data.consumeInput),
    ).rejects.toBeInstanceOf(SpotifyOAuthTransactionError);
  });

  it.each(["", "invalid", "a".repeat(1000)])(
    "rejects malformed state before consumption",
    async (state) => {
      const data = await fixture();

      await expect(
        consumeSpotifyOAuthTransaction({ ...data.consumeInput, state }),
      ).rejects.toBeInstanceOf(SpotifyOAuthTransactionError);

      await expect(
        SpotifyOAuthTransaction.countDocuments({
          userId: data.context.userId,
        }),
      ).resolves.toBe(1);
    },
  );
});
