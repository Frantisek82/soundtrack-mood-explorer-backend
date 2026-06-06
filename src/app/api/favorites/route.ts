import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";
import { cookies } from "next/headers";

/**
 * CORS configuration
 */
import { CORS_HEADERS } from "@/lib/cors";

/**
 * Preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
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
export async function GET() {
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
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
}

/**
 * POST /api/favorites
 */
export async function POST(req: Request) {
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
      headers: CORS_HEADERS,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json(
        { message: "Already in favorites" },
        { status: 409, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
}
