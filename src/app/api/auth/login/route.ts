import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import User from "@/models/User";
import { connectDB } from "@/lib/db";
import { generateToken } from "@/lib/jwt";
import { CORS_HEADERS } from "@/lib/cors";

/**
 * Email validation regex
 */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  try {
    await connectDB();

    let { email, password } = await req.json();

    // Normalize inputs
    email = email?.trim().toLowerCase();

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Validate email format
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { message: "Invalid email format" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const user = await User.findOne({ email });

    if (!user) {
      return NextResponse.json(
        { message: "Invalid credentials" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return NextResponse.json(
        { message: "Invalid credentials" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const token = generateToken({
      id: user._id.toString(),
      email: user.email,
    });

    const response = NextResponse.json(
      {
        message: "Login successful",
        user: {
          id: user._id,
          email: user.email,
        },
      },
      { headers: CORS_HEADERS },
    );

    // PRODUCTION-GRADE COOKIE
    response.cookies.set({
      name: "token",
      value: token,
      httpOnly: true, // not accessible from JS
      secure: process.env.NODE_ENV === "production", // HTTPS only in production
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 1 day
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
