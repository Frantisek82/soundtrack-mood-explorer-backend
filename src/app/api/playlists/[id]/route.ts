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
 * GET /api/playlists/:id
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { message: "Invalid playlist ID" },
        {
          status: 400,
          headers: getCorsHeaders(origin),
        },
      );
    }

    const playlist = await Playlist.findOne({
      _id: id,
      userId,
    }).populate("soundtracks");

    if (!playlist) {
      return NextResponse.json(
        { message: "Playlist not found" },
        {
          status: 404,
          headers: getCorsHeaders(origin),
        },
      );
    }

    return NextResponse.json(playlist, {
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

/**
 * PATCH /api/playlists/:id
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { message: "Invalid playlist ID" },
        {
          status: 400,
          headers: getCorsHeaders(origin),
        },
      );
    }

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

    const playlist = await Playlist.findOneAndUpdate(
      {
        _id: id,
        userId,
      },
      {
        name: name.trim(),
        description: typeof description === "string" ? description.trim() : "",
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!playlist) {
      return NextResponse.json(
        { message: "Playlist not found" },
        {
          status: 404,
          headers: getCorsHeaders(origin),
        },
      );
    }

    return NextResponse.json(playlist, {
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

/**
 * DELETE /api/playlists/:id
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { message: "Invalid playlist ID" },
        {
          status: 400,
          headers: getCorsHeaders(origin),
        },
      );
    }

    const playlist = await Playlist.findOneAndDelete({
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

    return NextResponse.json(
      { message: "Playlist deleted successfully" },
      {
        status: 200,
        headers: getCorsHeaders(origin),
      },
    );
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
