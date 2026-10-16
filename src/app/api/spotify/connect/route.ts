import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import { getSpotifyConfig } from "@/lib/spotify/config";
import { setSpotifyTransactionCookie } from "@/lib/spotify/cookies";
import { SpotifyGenerationError } from "@/lib/spotify/generation";
import { assertSpotifyPersistenceReady } from "@/lib/spotify/readiness";
import {
  assertSpotifyMutationRequest,
  getSpotifyCorsHeaders,
  spotifyPreflightResponse,
  SpotifyRequestError,
} from "@/lib/spotify/requests";
import {
  requireSpotifyApplicationSession,
  SpotifySessionError,
} from "@/lib/spotify/session";
import { createSpotifyOAuthTransaction } from "@/lib/spotify/transactions";

export const runtime = "nodejs";

function readConfiguration() {
  try {
    return getSpotifyConfig();
  } catch {
    return null;
  }
}

function unavailable(headers: Record<string, string>) {
  return NextResponse.json(
    { message: "Spotify connection unavailable" },
    { status: 503, headers },
  );
}

function requestFailure(error: unknown, headers: Record<string, string>) {
  if (error instanceof SpotifyRequestError) {
    return NextResponse.json(
      { message: "Spotify request rejected", code: error.code },
      { status: error.status, headers },
    );
  }

  return NextResponse.json(
    { message: "Internal server error" },
    { status: 500, headers },
  );
}

export async function OPTIONS(req: Request) {
  const headers = { "Cache-Control": "no-store", Vary: "Origin" };
  const config = readConfiguration();
  if (!config) return unavailable(headers);

  try {
    return spotifyPreflightResponse(req, config);
  } catch (error) {
    return requestFailure(error, headers);
  }
}

export async function POST(req: Request) {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const config = readConfiguration();
  if (!config) return unavailable(headers);

  try {
    Object.assign(headers, getSpotifyCorsHeaders(req, config));
    assertSpotifyMutationRequest(req, config);

    await connectDB();
    const applicationSession = await requireSpotifyApplicationSession();

    try {
      await assertSpotifyPersistenceReady();
    } catch {
      return unavailable(headers);
    }

    // No user ID, generation, session, or redirect is read from the body.
    const started = await createSpotifyOAuthTransaction({
      ...applicationSession,
      config,
    });

    const response = NextResponse.json(
      { authorizationUrl: started.authorizationUrl },
      { headers },
    );

    setSpotifyTransactionCookie(response, started.browserBinding, config);
    return response;
  } catch (error) {
    if (error instanceof SpotifySessionError) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers },
      );
    }

    if (error instanceof SpotifyGenerationError) {
      return NextResponse.json(
        {
          message: "Connection changed; start again",
          code: "connection_changed",
        },
        { status: 409, headers },
      );
    }

    return requestFailure(error, headers);
  }
}
