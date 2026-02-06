import mongoose, { Schema, models } from "mongoose";

/**
 * Soundtrack MongoDB schema
 * Represents a movie soundtrack with optional Spotify preview
 */
const SoundtrackSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    movie: {
      type: String,
      required: true,
      trim: true,
    },

    composer: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * List of moods associated with the soundtrack
     * Example: ["epic", "emotional", "calm"]
     */
    moods: {
      type: [String],
      default: [],
    },

    /**
     * Spotify Track ID (not full URL)
     * Example: "6pWgRkpqV2ydnK9y0gM8kC"
     */
    spotifyTrackId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Prevent model overwrite error in Next.js dev mode
 */
export default models.Soundtrack ||
  mongoose.model("Soundtrack", SoundtrackSchema);
