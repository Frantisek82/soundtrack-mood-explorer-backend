import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import { cookies } from "next/headers";
import { CORS_HEADERS } from "@/lib/cors";

/**
 * CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Extract user from cookie
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
 * GET /api/favorites/:id
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await connectDB();

    const { id } = await context.params;

    const userId = await getUserIdFromCookies();

    const favorite = await Favorite.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      soundtrackId: id,
    });

    return NextResponse.json(
      { isFavorite: !!favorite },
      { headers: corsHeaders },
    );
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }
}

/**
 * DELETE /api/favorites/:id
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await connectDB();

    const { id } = await context.params;

    const userId = await getUserIdFromCookies();

    await Favorite.deleteOne({
      userId: new mongoose.Types.ObjectId(userId),
      soundtrackId: id,
    });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Delete favorite error:", error);

    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }
}
