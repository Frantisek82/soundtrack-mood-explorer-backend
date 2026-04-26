import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";
import { cookies } from "next/headers";

/**
 * CORS configuration
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
};

/**
 * Preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
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
      headers: corsHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
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
      headers: corsHeaders,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json(
        { message: "Already in favorites" },
        { status: 409, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }
}