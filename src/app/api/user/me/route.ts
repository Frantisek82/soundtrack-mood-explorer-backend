import { NextResponse } from "next/server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import User from "@/models/User";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";

/**
 * CORS configuration
 */
import { CORS_HEADERS } from "@/lib/cors";

/**
 * Handle preflight (CORS)
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Extract user ID from httpOnly cookie
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
 * GET /api/user/me
 */
export async function GET() {
  try {
    await connectDB();

    const userId = await getUserIdFromCookies();

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return NextResponse.json(
        { message: "User not found" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json(user, {
      headers: CORS_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
}

/**
 * PUT /api/user/me
 */
export async function PUT(req: Request) {
  try {
    await connectDB();

    const userId = await getUserIdFromCookies();
    const { password } = await req.json();

    if (!password || password.length < 6) {
      return NextResponse.json(
        { message: "Password must be at least 6 characters long" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.findByIdAndUpdate(userId, {
      password: hashedPassword,
    });

    return NextResponse.json(
      { message: "Password updated successfully" },
      { headers: CORS_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
}

/**
 * DELETE /api/user/me
 */
export async function DELETE() {
  try {
    await connectDB();

    const userId = await getUserIdFromCookies();

    // Delete favorites first (cascade)
    await Favorite.deleteMany({
      userId: new mongoose.Types.ObjectId(userId),
    });

    // Delete user
    await User.findByIdAndDelete(userId);

    const response = NextResponse.json(
      { message: "Account deleted successfully" },
      { headers: CORS_HEADERS },
    );

    // Clear auth cookie after deletion
    response.cookies.set({
      name: "token",
      value: "",
      expires: new Date(0),
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
}
