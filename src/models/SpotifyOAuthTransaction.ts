import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

import { SpotifyCredentialSchema } from "./SpotifyCredentialSchema";

const hashField = {
  type: String,
  required: true,
  match: /^[a-f0-9]{64}$/,
  select: false,
};

const SpotifyOAuthTransactionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    generation: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    stateHash: { ...hashField },
    browserBindingHash: { ...hashField },
    sessionHash: { ...hashField },
    verifier: {
      type: SpotifyCredentialSchema,
      required: true,
      select: false,
    },
    redirectUri: {
      type: String,
      required: true,
      enum: [
        "http://127.0.0.1:3000/api/spotify/callback",
        "https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback",
      ],
    },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    strict: "throw",
    toJSON: {
      transform() {
        throw new Error("Spotify OAuth transactions must not be serialized");
      },
    },
  },
);

SpotifyOAuthTransactionSchema.index({ stateHash: 1 }, { unique: true });
SpotifyOAuthTransactionSchema.index({ userId: 1 });
SpotifyOAuthTransactionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);

export type SpotifyOAuthTransactionRecord = InferSchemaType<
  typeof SpotifyOAuthTransactionSchema
>;

const SpotifyOAuthTransaction =
  (mongoose.models.SpotifyOAuthTransaction as
    | Model<SpotifyOAuthTransactionRecord>
    | undefined) ??
  mongoose.model("SpotifyOAuthTransaction", SpotifyOAuthTransactionSchema);

export default SpotifyOAuthTransaction;
