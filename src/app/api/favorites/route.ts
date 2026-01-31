import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

/**
 * CORS preflight
 */
export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * GET /api/favorites
 * Returns all favorites for the logged-in user
 */
export async function GET(req: Request) {
  try {
    await connectDB();

    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    const favorites = await Favorite.find({
      userId: decoded.id,
    }).populate("soundtrackId");

    return NextResponse.json(favorites, {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    console.error("Get favorites error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /api/favorites
 * Adds a soundtrack to favorites
 */
export async function POST(req: Request) {
  try {
    await connectDB();

    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    const { soundtrackId } = await req.json();

    if (!soundtrackId) {
      return NextResponse.json(
        { message: "soundtrackId is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const favorite = await Favorite.create({
      userId: decoded.id,
      soundtrackId,
    });

    return NextResponse.json(favorite, {
      headers: CORS_HEADERS,
    });
  } catch (error: any) {
    // Handle duplicate favorite gracefully
    if (error.code === 11000) {
      return NextResponse.json(
        { message: "Already in favorites" },
        { status: 409, headers: CORS_HEADERS }
      );
    }

    console.error("Add favorite error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
