import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Favorite from "@/models/Favorite";
import { verifyToken } from "@/lib/jwt";
import type { Soundtrack } from "@/types/soundtrack";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const token = auth.split(" ")[1];
    const { id: userId } = verifyToken(token);

    const { soundtrackId } = await req.json();

    await connectDB();

    const favorite = await Favorite.create({
      userId,
      soundtrackId,
    });

    return NextResponse.json(favorite, {
      status: 201,
      headers: CORS_HEADERS,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json(
        { message: "Soundtrack already in favorites" },
        { status: 409, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json(
      { message: "Failed to add favorite" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const token = auth.split(" ")[1];
    const { id: userId } = verifyToken(token);

    await connectDB();

    const favorites = await Favorite.find({ userId }).populate("soundtrackId");

    return NextResponse.json(favorites, {
      headers: CORS_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { message: "Failed to fetch favorites" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
