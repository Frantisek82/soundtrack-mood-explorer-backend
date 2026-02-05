import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: Request) {
  try {
    await connectDB();

    const { searchParams } = new URL(req.url);
    const mood = searchParams.get("mood");

    const query = mood ? { moods: mood } : {};
    const soundtracks = await Soundtrack.find(query);

    return NextResponse.json(soundtracks, {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "Failed to fetch soundtracks" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
