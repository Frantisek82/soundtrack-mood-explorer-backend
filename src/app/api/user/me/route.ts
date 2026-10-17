import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import User from "@/models/User";
import { verifyToken } from "@/lib/jwt";
import { connectDB } from "@/lib/db";
import { deleteApplicationAccount } from "@/lib/account-deletion";
import { clearSpotifyTransactionCookieForTransport } from "@/lib/spotify/cookies";
import { SpotifyGenerationError } from "@/lib/spotify/generation";
import {
  requireSpotifyApplicationSession,
  SpotifySessionError,
} from "@/lib/spotify/session";

/**
 * CORS configuration
 */
import { getCorsHeaders } from "@/lib/cors";

/**
 * Handle preflight (CORS)
 */
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
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
export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  try {
    await connectDB();

    const userId = await getUserIdFromCookies();

    const user = await User.findById(userId).select(
      "_id name email createdAt updatedAt __v",
    );

    if (!user) {
      return NextResponse.json(
        { message: "User not found" },
        { status: 404, headers: getCorsHeaders(origin) },
      );
    }

    return NextResponse.json(
      {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        __v: user.__v,
      },
      { headers: getCorsHeaders(origin) },
    );
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }
}

/**
 * PUT /api/user/me
 */
export async function PUT(req: Request) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const userId = await getUserIdFromCookies();
    const { password } = await req.json();

    if (!password || password.length < 6) {
      return NextResponse.json(
        { message: "Password must be at least 6 characters long" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.findByIdAndUpdate(userId, {
      password: hashedPassword,
    });

    return NextResponse.json(
      { message: "Password updated successfully" },
      { headers: getCorsHeaders(origin) },
    );
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }
}

/**
 * DELETE /api/user/me
 */
export async function DELETE(req: Request) {
  const origin = req.headers.get("origin");
  const headers = {
    ...getCorsHeaders(origin),
    "Cache-Control": "no-store",
  };

  try {
    await connectDB();
    const { userId } = await requireSpotifyApplicationSession();

    await deleteApplicationAccount(userId);

    const response = NextResponse.json(
      { message: "Account deleted successfully" },
      { headers },
    );

    // Clear cookies only after the deletion transaction commits.
    response.cookies.set({
      name: "token",
      value: "",
      expires: new Date(0),
      path: "/",
    });

    clearSpotifyTransactionCookieForTransport(
      response,
      new URL(req.url).protocol === "https:",
    );

    return response;
  } catch (error) {
    if (
      error instanceof SpotifySessionError ||
      error instanceof SpotifyGenerationError
    ) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers },
      );
    }

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers },
    );
  }
}
