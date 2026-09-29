import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";

const catalogue = [
  {
    title: "Time",
    movie: "Inception",
    composer: "Hans Zimmer",
    moods: ["Epic", "Emotional"],
    spotifyTrackId: "6ZFbXIJkuI1dVNWvzJzown",
  },
  {
    title: "Cornfield Chase",
    movie: "Interstellar",
    composer: "Hans Zimmer",
    moods: ["Calm"],
    spotifyTrackId: "6pWgRkpqVfxnj3WuIcJ7WP",
  },
];

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
