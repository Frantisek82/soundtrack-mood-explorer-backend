import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";
import { cookies } from "next/headers";
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
 * Get user from cookie
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
 * GET /api/favorites
 */
export async function GET(req: Request) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();

    const favorites = await Favorite.find({
      userId: new mongoose.Types.ObjectId(userId),
    }).populate("soundtrackId");

    const soundtracks = favorites
      .map((fav) => fav.soundtrackId)
      .filter(Boolean);

    return NextResponse.json(soundtracks, {
      headers: getCorsHeaders(origin),
    });
  } catch (error) {
    return NextResponse.json(
      { message: "Unauthorized" },
      {
        status: 401,
        headers: getCorsHeaders(origin),
      },
    );
  }
}

/**
 * POST /api/favorites
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();

    const { soundtrackId } = await req.json();

    const favorite = await Favorite.create({
      userId: new mongoose.Types.ObjectId(userId),
      soundtrackId: new mongoose.Types.ObjectId(soundtrackId),
    });

    return NextResponse.json(favorite, {
      status: 201,
      headers: getCorsHeaders(origin),
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json(
        { message: "Already in favorites" },
        {
          status: 409,
          headers: getCorsHeaders(origin),
        },
      );
    }

    return NextResponse.json(
      { message: "Unauthorized" },
      {
        status: 401,
        headers: getCorsHeaders(origin),
      },
    );
  }
}
