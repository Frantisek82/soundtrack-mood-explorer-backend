import mongoose, { type ClientSession } from "mongoose";

import User from "@/models/User";

export class SpotifyGenerationError extends Error {
  constructor(
    public readonly code:
      | "invalid_generation_context"
      | "stale_spotify_generation",
  ) {
    super(code);
    this.name = "SpotifyGenerationError";
  }
}

function identifier(userId: string): mongoose.Types.ObjectId {
  if (!/^[a-f0-9]{24}$/.test(userId)) {
    throw new SpotifyGenerationError("invalid_generation_context");
  }
  return new mongoose.Types.ObjectId(userId);
}

function validGeneration(generation: number): boolean {
  return Number.isSafeInteger(generation) && generation >= 0;
}

function writableCounter(field: string) {
  return {
    $or: [
      { [field]: { $exists: false } },
      {
        [field]: {
          $gte: 0,
          $lt: Number.MAX_SAFE_INTEGER,
          $mod: [1, 0],
        },
      },
    ],
  };
}

const transactionOptions = {
  readPreference: "primary" as const,
  readConcern: { level: "snapshot" as const },
  writeConcern: { w: "majority" as const },
  maxCommitTimeMS: 5000,
};

// work must contain only database operations using the supplied session.
// MongoDB may retry it. Provider HTTP and other external effects belong outside.
export async function withSpotifyLinkGeneration<T>(
  userId: string,
  generation: number,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const _id = identifier(userId);
  if (!validGeneration(generation)) {
    throw new SpotifyGenerationError("invalid_generation_context");
  }

  const generationMatch =
    generation === 0
      ? {
          $or: [
            { spotifyLinkGeneration: 0 },
            { spotifyLinkGeneration: { $exists: false } },
          ],
        }
      : { spotifyLinkGeneration: generation };

  return mongoose.connection.transaction(async (session) => {
    const result = await User.updateOne(
      {
        _id,
        $and: [generationMatch, writableCounter("spotifyLinkWriteVersion")],
      },
      {
        $set: { spotifyLinkGeneration: generation },
        $inc: { spotifyLinkWriteVersion: 1 },
      },
      { session, runValidators: true },
    );

    if (result.matchedCount !== 1) {
      throw new SpotifyGenerationError("stale_spotify_generation");
    }

    return work(session);
  }, transactionOptions);
}

// The cleanup callback runs atomically with generation invalidation.
// Account-deletion cleanup may also delete the User inside this callback.
export async function invalidateSpotifyLinkGeneration<T>(
  userId: string,
  work: (session: ClientSession, nextGeneration: number) => Promise<T>,
): Promise<{ generation: number; result: T }> {
  const _id = identifier(userId);

  return mongoose.connection.transaction(async (session) => {
    const user = await User.findOneAndUpdate(
      {
        _id,
        $and: [
          writableCounter("spotifyLinkGeneration"),
          writableCounter("spotifyLinkWriteVersion"),
        ],
      },
      {
        $inc: {
          spotifyLinkGeneration: 1,
          spotifyLinkWriteVersion: 1,
        },
      },
      { session, new: true, runValidators: true },
    ).select("+spotifyLinkGeneration");

    if (!user || !validGeneration(user.spotifyLinkGeneration)) {
      throw new SpotifyGenerationError("stale_spotify_generation");
    }

    const generation: number = user.spotifyLinkGeneration;
    const result = await work(session, generation);
    return { generation, result };
  }, transactionOptions);
}
