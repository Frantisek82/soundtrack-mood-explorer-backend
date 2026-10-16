import { createHash, randomBytes } from "node:crypto";

import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import type { SpotifyConfig } from "./config";
import {
  createSpotifyBrowserBinding,
  SPOTIFY_TRANSACTION_TTL_SECONDS,
} from "./cookies";
import { encryptSpotifyCredential } from "./encryption";
import {
  SpotifyGenerationError,
  withSpotifyLinkGeneration,
} from "./generation";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

type TransactionContext = {
  userId: string;
  generation: number;
  sessionToken: string;
  config: EnabledSpotifyConfig;
  now?: () => Date;
};

type ConsumeInput = TransactionContext & {
  state: string;
  browserBinding: string;
};

export class SpotifyOAuthTransactionError extends Error {
  constructor() {
    super("invalid_transaction");
    this.name = "SpotifyOAuthTransactionError";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionHash(token: string): string {
  if (typeof token !== "string" || token.length === 0 || token.length > 8192) {
    throw new SpotifyOAuthTransactionError();
  }
  return hash(token);
}

function currentTime(clock?: () => Date): Date {
  const now = clock ? clock() : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new SpotifyOAuthTransactionError();
  }
  return now;
}

function isRandomValue(value: string): boolean {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

// The route must provide a verified application session and its existing User.
// browserBinding belongs only in the HttpOnly cookie, not the JSON response.
export async function createSpotifyOAuthTransaction(
  input: TransactionContext,
): Promise<{ authorizationUrl: string; browserBinding: string }> {
  const state = randomBytes(32).toString("base64url");
  const browserBinding = createSpotifyBrowserBinding();
  const verifier = randomBytes(32).toString("base64url");
  const initiatingSessionHash = sessionHash(input.sessionToken);

  const encryptedVerifier = encryptSpotifyCredential(
    verifier,
    {
      userId: input.userId,
      generation: input.generation,
      purpose: "pkce_verifier",
    },
    input.config,
  );

  const authorizationUrl = new URL("https://accounts.spotify.com/authorize");
  authorizationUrl.searchParams.set("client_id", input.config.clientId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", input.config.redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set(
    "code_challenge",
    createHash("sha256").update(verifier).digest("base64url"),
  );

  await withSpotifyLinkGeneration(
    input.userId,
    input.generation,
    async (session) => {
      const now = currentTime(input.now);

      await new SpotifyOAuthTransaction({
        userId: input.userId,
        generation: input.generation,
        stateHash: hash(state),
        browserBindingHash: hash(browserBinding),
        sessionHash: initiatingSessionHash,
        verifier: encryptedVerifier,
        redirectUri: input.config.redirectUri,
        expiresAt: new Date(
          now.getTime() + SPOTIFY_TRANSACTION_TTL_SECONDS * 1000,
        ),
      }).save({ session });
    },
  );

  return {
    authorizationUrl: authorizationUrl.toString(),
    browserBinding,
  };
}

// The returned verifier remains encrypted and is backend-only.
// Consume first, then decrypt/exchange outside the database transaction.
// Valid denial callbacks also consume their transaction without exchanging.
export async function consumeSpotifyOAuthTransaction(
  input: ConsumeInput,
): Promise<{ encryptedVerifier: unknown }> {
  if (!isRandomValue(input.state) || !isRandomValue(input.browserBinding)) {
    throw new SpotifyOAuthTransactionError();
  }

  const initiatingSessionHash = sessionHash(input.sessionToken);

  try {
    return await withSpotifyLinkGeneration(
      input.userId,
      input.generation,
      async (session) => {
        const transaction = await SpotifyOAuthTransaction.findOneAndDelete(
          {
            userId: input.userId,
            generation: input.generation,
            stateHash: hash(input.state),
            browserBindingHash: hash(input.browserBinding),
            sessionHash: initiatingSessionHash,
            redirectUri: input.config.redirectUri,
            expiresAt: { $gt: currentTime(input.now) },
          },
          { session },
        )
          .select("+verifier")
          .lean();

        if (!transaction) {
          throw new SpotifyOAuthTransactionError();
        }

        return { encryptedVerifier: transaction.verifier };
      },
    );
  } catch (error) {
    if (error instanceof SpotifyGenerationError) {
      throw new SpotifyOAuthTransactionError();
    }
    throw error;
  }
}
