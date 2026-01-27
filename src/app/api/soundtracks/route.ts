import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";

export async function GET(req: Request) {
  try {
    await connectDB();

    const { searchParams } = new URL(req.url);
    const mood = searchParams.get("mood");

    const query = mood ? { moods: mood } : {};
    const soundtracks = await Soundtrack.find(query);

    return NextResponse.json(soundtracks);
  } catch (error) {
    return NextResponse.json(
      { message: "Failed to fetch soundtracks" },
      { status: 500 }
    );
  }
}
