import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";
import { soundtrackCatalogue as catalogue } from "@/data/soundtrack-catalogue";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  for (const soundtrack of catalogue) {
    const existing = await Soundtrack.exists({
      title: soundtrack.title,
      movie: soundtrack.movie,
      composer: soundtrack.composer,
    });

    if (!existing) {
      await Soundtrack.create(soundtrack);
    }
  }

  return NextResponse.json({ message: "Database seeded" });
}
