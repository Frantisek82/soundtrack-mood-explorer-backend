import mongoose, { Schema, models } from "mongoose";

const SoundtrackSchema = new Schema(
  {
    title: { type: String, required: true },
    movie: { type: String, required: true },
    composer: { type: String, required: true },
    moods: [{ type: String }], // simple for now
  },
  { timestamps: true }
);

export default models.Soundtrack ||
  mongoose.model("Soundtrack", SoundtrackSchema);
