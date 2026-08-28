import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { cookies } from "next/headers";

import Playlist from "@/models/Playlist";

import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";

/**
 * Preflight
 */
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/**
 * Get authenticated user ID from cookies
 */
async function getUserIdFromCookies(): Promise<string> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    throw new Error("Unauthorized");
  }

  const decoded = verifyToken(token);

  return decoded.id;
}

/**
 * DELETE /api/playlists/:id/soundtracks/:soundtrackId
 */
export async function DELETE(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      soundtrackId: string;
    }>;
  },
) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();
    const { id, soundtrackId } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { message: "Playlist not found" },
        {
          status: 404,
          headers: getCorsHeaders(origin),
        },
      );
    }

    if (!mongoose.Types.ObjectId.isValid(soundtrackId)) {
      return NextResponse.json(
        { message: "Soundtrack not found" },
        {
          status: 404,
          headers: getCorsHeaders(origin),
        },
      );
    }

    const playlist = await Playlist.findOne({
      _id: id,
      userId,
    });

    if (!playlist) {
      return NextResponse.json(
        { message: "Playlist not found" },
        {
          status: 404,
          headers: getCorsHeaders(origin),
        },
      );
    }

    const soundtrackExists = playlist.soundtracks.some(
      (id: mongoose.Types.ObjectId) => id.toString() === soundtrackId,
    );

    if (!soundtrackExists) {
      return NextResponse.json(
        { message: "Soundtrack not found in playlist" },
        {
          status: 404,
          headers: getCorsHeaders(origin),
        },
      );
    }

    playlist.soundtracks = playlist.soundtracks.filter(
      (id: mongoose.Types.ObjectId) => id.toString() !== soundtrackId,
    );

    await playlist.save();
    await playlist.populate("soundtracks");

    return NextResponse.json(playlist, {
      status: 200,
      headers: getCorsHeaders(origin),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(
        { message: "Unauthorized" },
        {
          status: 401,
          headers: getCorsHeaders(origin),
        },
      );
    }

    return NextResponse.json(
      { message: "Internal server error" },
      {
        status: 500,
        headers: getCorsHeaders(origin),
      },
    );
  }
}
