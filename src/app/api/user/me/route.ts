import { NextResponse } from "next/server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "@/models/User";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";

/**
 * CORS configuration
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Handle preflight requests (required for CORS with Authorization header)
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Extract user ID from Authorization header
 */
function getUserIdFromRequest(req: Request): string {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split(" ")[1];
  const decoded = verifyToken(token);

  return decoded.id;
}

/**
 * GET /api/user/me
 * Read current user (without password)
 */
export async function GET(req: Request) {
  try {
    await connectDB();

    const userId = getUserIdFromRequest(req);

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return NextResponse.json(
        { message: "User not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(user, {
      headers: corsHeaders,
    });
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }
}

/**
 * PUT /api/user/me
 * Update user password
 */
export async function PUT(req: Request) {
  try {
    await connectDB();

    const userId = getUserIdFromRequest(req);
    const { password } = await req.json();

    if (!password || password.length < 6) {
      return NextResponse.json(
        { message: "Password must be at least 6 characters long" },
        { status: 400, headers: corsHeaders }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.findByIdAndUpdate(userId, {
      password: hashedPassword,
    });

    return NextResponse.json(
      { message: "Password updated successfully" },
      { headers: corsHeaders }
    );
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }
}

/**
 * DELETE /api/user/me
 * Delete user and related favorites
 */
export async function DELETE(req: Request) {
  try {
    await connectDB();

    const userId = getUserIdFromRequest(req);

    // Delete related favorites first
    await Favorite.deleteMany({
      userId: new mongoose.Types.ObjectId(userId),
    });

    // Delete user
    await User.findByIdAndDelete(userId);

    return NextResponse.json(
      { message: "Account deleted successfully" },
      { headers: corsHeaders }
    );
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }
}
