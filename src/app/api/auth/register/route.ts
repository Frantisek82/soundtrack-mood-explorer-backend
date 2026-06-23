import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { getCorsHeaders  } from "@/lib/cors";

/**
 * Email validation regex
 * - Requires @
 * - Requires dot
 * - Requires at least 2 characters after dot
 * - No spaces allowed
 */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * CORS preflight
 */
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return NextResponse.json({}, {
    headers: getCorsHeaders(origin),
  });
}

/**
 * POST /api/auth/register
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  try {
    await connectDB();

    let { name, email, password } = await req.json();

    // Normalize inputs
    name = name?.trim();
    email = email?.trim().toLowerCase();

    if (!name || !email || !password) {
      return NextResponse.json(
        { message: "All fields are required" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    // Validate email format
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { message: "Invalid email format" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    // Optional: basic password length enforcement
    if (password.length < 6) {
      return NextResponse.json(
        { message: "Password must be at least 6 characters long" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { message: "User already exists" },
        { status: 409, headers: getCorsHeaders(origin) },
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      name,
      email,
      password: hashedPassword,
    });

    return NextResponse.json(
      { message: "User registered successfully" },
      { status: 201, headers: getCorsHeaders(origin) },
    );
  } catch (error) {
    console.error("Register error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }
}
