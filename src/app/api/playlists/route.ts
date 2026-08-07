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
 * GET /api/playlists
 */
export async function GET(req: Request) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();

    const playlists = await Playlist.find({
      userId: new mongoose.Types.ObjectId(userId),
    }).sort({ createdAt: -1 });

    return NextResponse.json(playlists, {
      headers: getCorsHeaders(origin),
    });
  } catch (error) {
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

/**
 * POST /api/playlists
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();

    const { name, description } = await req.json();

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { message: "Playlist name is required" },
        {
          status: 400,
          headers: getCorsHeaders(origin),
        },
      );
    }

    const playlist = await Playlist.create({
      userId: new mongoose.Types.ObjectId(userId),
      name: name.trim(),
      description: description?.trim() || "",
      soundtracks: [],
    });

    return NextResponse.json(playlist, {
      status: 201,
      headers: getCorsHeaders(origin),
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return NextResponse.json(
        { message: "Playlist already exists" },
        {
          status: 409,
          headers: getCorsHeaders(origin),
        },
      );
    }

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
