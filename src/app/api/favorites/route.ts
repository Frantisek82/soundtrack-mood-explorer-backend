import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";

/**
 * CORS configuration
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Preflight request handler (REQUIRED for CORS)
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/favorites
 * Returns Soundtrack[]
 */
export async function GET(req: Request) {
  try {
    await connectDB();

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    const favorites = await Favorite.find({
      userId: new mongoose.Types.ObjectId(decoded.id),
    }).populate("soundtrackId");

    // Normalize: return Soundtrack[]
    const soundtracks = favorites
      .map((fav) => fav.soundtrackId)
      .filter(Boolean);

    return NextResponse.json(soundtracks, {
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("GET /favorites error:", error);
    return NextResponse.json(
      { message: "Failed to load favorites" },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * POST /api/favorites
 * Add soundtrack to favorites
 */
export async function POST(req: Request) {
  try {
    await connectDB();

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    const { soundtrackId } = await req.json();

    const favorite = await Favorite.create({
      userId: new mongoose.Types.ObjectId(decoded.id),
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

    console.error("POST /favorites error:", error);
    return NextResponse.json(
      { message: "Failed to add favorite" },
      { status: 500, headers: corsHeaders }
    );
  }
}
