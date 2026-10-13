import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

import { SpotifyCredentialSchema } from "./SpotifyCredentialSchema";

const SpotifyConnectionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    accountId: {
      type: String,
      required: true,
      maxlength: 256,
      match: /^\S+$/,
    },
    displayName: { type: String, maxlength: 256, default: null },
    status: {
      type: String,
      enum: ["connected", "reauthorization_required"],
      required: true,
    },
    grantedScopes: { type: [String], default: [] },
    originalAuthorizedAt: { type: Date, required: true },
    estimatedRefreshExpiry: { type: Date, required: true },
    accessExpiresAt: { type: Date },
    accessToken: {
      type: SpotifyCredentialSchema,
      select: false,
      required: function (this: { status: string }) {
        return this.status === "connected";
      },
    },
    refreshToken: {
      type: SpotifyCredentialSchema,
      select: false,
      required: function (this: { status: string }) {
        return this.status === "connected";
      },
    },
    generation: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    refreshLeaseOwner: {
      type: String,
      maxlength: 128,
      select: false,
    },
    refreshLeaseExpiresAt: { type: Date, select: false },
  },
  {
    timestamps: true,
    strict: "throw",
    toJSON: {
      transform() {
        throw new Error("Spotify connections require an explicit public DTO");
      },
    },
  },
);

SpotifyConnectionSchema.index({ userId: 1 }, { unique: true });
SpotifyConnectionSchema.index({ accountId: 1 }, { unique: true });

export type SpotifyConnectionRecord = InferSchemaType<
  typeof SpotifyConnectionSchema
>;

const SpotifyConnection =
  (mongoose.models.SpotifyConnection as
    | Model<SpotifyConnectionRecord>
    | undefined) ??
  mongoose.model("SpotifyConnection", SpotifyConnectionSchema);

export default SpotifyConnection;
