import { NextResponse } from "next/server";
import User from "@/models/User";
import { connectDB } from "@/lib/db";
import { verifyPassword, signToken } from "@/lib/auth";
import type { Soundtrack } from "@/types/soundtrack";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    await connectDB();

    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json(
        { message: "Invalid credentials" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return NextResponse.json(
        { message: "Invalid credentials" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const token = signToken({
      id: user._id,
      email: user.email,
    });

    return NextResponse.json(
      {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { message: "Login failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
