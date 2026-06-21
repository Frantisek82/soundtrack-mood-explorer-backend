import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");

  try {
    await connectDB();

    const { searchParams } = new URL(req.url);
    const mood = searchParams.get("mood");

    const query = mood ? { moods: mood } : {};
    const soundtracks = await Soundtrack.find(query);

    return NextResponse.json(soundtracks, {
      headers: getCorsHeaders(origin),
    });
  } catch (error) {
    console.error("GET /soundtracks error:", error);

    return NextResponse.json(
      { message: "Failed to fetch soundtracks" },
      {
        status: 500,
        headers: getCorsHeaders(origin),
      },
    );
  }
}