import mongoose, { Schema, models } from "mongoose";
import type { Soundtrack } from "@/types/soundtrack";

const FavoriteSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    soundtrackId: {
      type: Schema.Types.ObjectId,
      ref: "Soundtrack",
      required: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicates
FavoriteSchema.index({ userId: 1, soundtrackId: 1 }, { unique: true });

export default models.Favorite ||
  mongoose.model("Favorite", FavoriteSchema);
