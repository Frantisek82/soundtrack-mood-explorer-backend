import mongoose, { Schema, models } from "mongoose";

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    spotifyLinkGeneration: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
      validate: {
        validator: Number.isSafeInteger,
        message: "Invalid Spotify link generation",
      },
    },
    spotifyLinkWriteVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
      validate: {
        validator: Number.isSafeInteger,
        message: "Invalid Spotify link write version",
      },
    },
  },
  { timestamps: true },
);

export default models.User || mongoose.model("User", UserSchema);
