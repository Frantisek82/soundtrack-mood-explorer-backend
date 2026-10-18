import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import { getSpotifyConfig } from "@/lib/spotify/config";
import { clearSpotifyTransactionCookie } from "@/lib/spotify/cookies";
import { disconnectSpotifyAccount } from "@/lib/spotify/disconnect";
import { SpotifyGenerationError } from "@/lib/spotify/generation";
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

function failure(error: unknown, headers: Record<string, string>) {
  if (error instanceof SpotifySessionError) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers },
    );
  }

  if (error instanceof SpotifyRequestError) {
    return NextResponse.json(
      { message: "Spotify request rejected", code: error.code },
      { status: error.status, headers },
    );
  }

  if (error instanceof SpotifyGenerationError) {
    return NextResponse.json(
      { message: "Connection changed; try again", code: "connection_changed" },
      { status: 409, headers },
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
    return failure(error, headers);
  }
}

export async function DELETE(req: Request) {
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
    const { userId } = await requireSpotifyApplicationSession();
    await disconnectSpotifyAccount(userId);

    const response = new NextResponse(null, { status: 204, headers });
    clearSpotifyTransactionCookie(response, config);
    return response;
  } catch (error) {
    return failure(error, headers);
  }
}
