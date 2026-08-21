import mongoose, { Schema, models } from "mongoose";

const PlaylistSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    soundtracks: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "Soundtrack",
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

PlaylistSchema.index({ userId: 1, name: 1 }, { unique: true });

const Playlist = models.Playlist || mongoose.model("Playlist", PlaylistSchema);

export default Playlist;
