import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import {
  parseSpotifyCallbackParameters,
  SpotifyCallbackParametersError,
} from "@/lib/spotify/callback-parameters";
import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  clearSpotifyTransactionCookie,
  SPOTIFY_TRANSACTION_COOKIE,
} from "@/lib/spotify/cookies";
import { decryptSpotifyCredential } from "@/lib/spotify/encryption";
import { SpotifyGenerationError } from "@/lib/spotify/generation";
import {
  persistSpotifyAccountLink,
  SpotifyAccountConflictError,
} from "@/lib/spotify/link";
import { authorizeSpotifyAccount } from "@/lib/spotify/provider";
import { assertSpotifyPersistenceReady } from "@/lib/spotify/readiness";
import {
  spotifyCallbackResultUrl,
  type SpotifyCallbackResult,
} from "@/lib/spotify/redirect";
import {
  requireSpotifyApplicationSession,
  SpotifySessionError,
} from "@/lib/spotify/session";
import {
  consumeSpotifyOAuthTransaction,
  SpotifyOAuthTransactionError,
} from "@/lib/spotify/transactions";

export const runtime = "nodejs";

const callbackHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function enabledConfiguration() {
  try {
    const config = getSpotifyConfig();
    return config.enabled ? config : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const config = enabledConfiguration();
  if (!config) {
    return NextResponse.json(
      { message: "Spotify connection unavailable" },
      { status: 503, headers: callbackHeaders },
    );
  }

  function complete(result: SpotifyCallbackResult) {
    const response = NextResponse.redirect(
      spotifyCallbackResultUrl(config!, result),
      { status: 303, headers: callbackHeaders },
    );
    clearSpotifyTransactionCookie(response, config!);
    return response;
  }

  try {
    const parameters = parseSpotifyCallbackParameters(
      new URL(req.url).searchParams,
    );

    await connectDB();
    const applicationSession = await requireSpotifyApplicationSession();
    const cookieStore = await cookies();
    const browserBinding = cookieStore.get(SPOTIFY_TRANSACTION_COOKIE)?.value;

    if (!browserBinding) {
      throw new SpotifyOAuthTransactionError();
    }

    await assertSpotifyPersistenceReady();

    const consumed = await consumeSpotifyOAuthTransaction({
      ...applicationSession,
      state: parameters.state,
      browserBinding,
      config,
    });

    if (parameters.kind === "denied") {
      return complete("denied");
    }
    if (parameters.kind === "provider_error") {
      return complete("provider_error");
    }

    const verifier = decryptSpotifyCredential(
      consumed.encryptedVerifier,
      {
        userId: applicationSession.userId,
        generation: applicationSession.generation,
        purpose: "pkce_verifier",
      },
      config,
    );

    // Provider HTTP is outside the database transaction.
    const authorization = await authorizeSpotifyAccount({
      code: parameters.code,
      verifier,
      config,
    });

    // Recheck session expiry and User state after provider requests.
    const currentSession = await requireSpotifyApplicationSession();
    if (
      currentSession.userId !== applicationSession.userId ||
      currentSession.sessionToken !== applicationSession.sessionToken ||
      currentSession.generation !== applicationSession.generation
    ) {
      throw new SpotifyOAuthTransactionError();
    }

    await persistSpotifyAccountLink({
      userId: applicationSession.userId,
      generation: applicationSession.generation,
      authorization,
      config,
    });

    return complete("connected");
  } catch (error) {
    if (error instanceof SpotifySessionError) {
      return complete("session_expired");
    }
    if (error instanceof SpotifyAccountConflictError) {
      return complete("account_conflict");
    }
    if (
      error instanceof SpotifyCallbackParametersError ||
      error instanceof SpotifyOAuthTransactionError ||
      error instanceof SpotifyGenerationError
    ) {
      return complete("invalid_transaction");
    }

    // Never forward or log provider bodies, credentials, or raw exceptions.
    return complete("provider_error");
  }
}
