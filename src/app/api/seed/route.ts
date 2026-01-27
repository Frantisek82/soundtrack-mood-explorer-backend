import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";

export async function POST() {
  await connectDB();

  await Soundtrack.deleteMany();

  await Soundtrack.insertMany([
    {
      title: "Time",
      movie: "Inception",
      composer: "Hans Zimmer",
      moods: ["Epic", "Emotional"],
    },
    {
      title: "Cornfield Chase",
      movie: "Interstellar",
      composer: "Hans Zimmer",
      moods: ["Calm"],
    },
  ]);

  return NextResponse.json({ message: "Database seeded" });
}
