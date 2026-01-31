import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
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
 * DELETE /api/favorites/:id
 * :id === soundtrackId
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();

    // ✅ FIX: await params
    const { id } = await context.params;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    // ✅ Cast BOTH ids to ObjectId
    await Favorite.findOneAndDelete({
      userId: new mongoose.Types.ObjectId(decoded.id),
      soundtrackId: new mongoose.Types.ObjectId(id),
    });

    return NextResponse.json(
      { success: true },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Delete favorite error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}