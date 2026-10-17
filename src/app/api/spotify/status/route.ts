import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import { getSpotifyConfig } from "@/lib/spotify/config";
import {
  getSpotifyCorsHeaders,
  spotifyPreflightResponse,
  SpotifyRequestError,
} from "@/lib/spotify/requests";
import {
  requireSpotifyApplicationSession,
  SpotifySessionError,
} from "@/lib/spotify/session";
import { toSpotifyConnectionStatus } from "@/lib/spotify/status";
import SpotifyConnection from "@/models/SpotifyConnection";

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

  // Do not log database errors or serialize connection records.
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

export async function GET(req: Request) {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const config = readConfiguration();
  if (!config) return unavailable(headers);

  try {
    Object.assign(headers, getSpotifyCorsHeaders(req, config));

    await connectDB();
    const { userId, generation } = await requireSpotifyApplicationSession();

    const connection = await SpotifyConnection.findOne({
      userId,
      generation,
    })
      .select({ _id: 0, status: 1, displayName: 1 })
      .lean();

    return NextResponse.json(toSpotifyConnectionStatus(connection), {
      headers,
    });
  } catch (error) {
    return failure(error, headers);
  }
}
