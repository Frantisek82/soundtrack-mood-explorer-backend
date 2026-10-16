import { cookies } from "next/headers";

import { verifyToken } from "@/lib/jwt";
import User from "@/models/User";

export class SpotifySessionError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "SpotifySessionError";
  }
}

export async function requireSpotifyApplicationSession(): Promise<{
  userId: string;
  generation: number;
  sessionToken: string;
}> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("token")?.value;

  if (!sessionToken || sessionToken.length > 8192) {
    throw new SpotifySessionError();
  }

  let userId: string;
  try {
    const decoded = verifyToken(sessionToken);
    if (
      !decoded ||
      typeof decoded.id !== "string" ||
      !/^[a-f0-9]{24}$/.test(decoded.id)
    ) {
      throw new SpotifySessionError();
    }
    userId = decoded.id;
  } catch {
    throw new SpotifySessionError();
  }

  const user = await User.findById(userId)
    .select("_id spotifyLinkGeneration")
    .lean<{ spotifyLinkGeneration?: unknown } | null>();

  if (!user) throw new SpotifySessionError();

  const generation =
    user.spotifyLinkGeneration === undefined ? 0 : user.spotifyLinkGeneration;

  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    throw new SpotifySessionError();
  }

  return { userId, generation, sessionToken };
}
