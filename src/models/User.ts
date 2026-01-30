import mongoose, { Schema, models } from "mongoose";
import type { Soundtrack } from "@/types/soundtrack";

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  },
  { timestamps: true }
);

export default models.User || mongoose.model("User", UserSchema);
