import { Schema } from "mongoose";

function canonicalBase64(bytes?: number) {
  return (value: string) => {
    const decoded = Buffer.from(value, "base64");
    return (
      decoded.length > 0 &&
      decoded.length <= 16_384 &&
      decoded.toString("base64") === value &&
      (bytes === undefined || decoded.length === bytes)
    );
  };
}

export const SpotifyCredentialSchema = new Schema(
  {
    version: { type: Number, required: true, enum: [1] },
    keyId: {
      type: String,
      required: true,
      match: /^[A-Za-z0-9_-]{1,64}$/,
    },
    iv: {
      type: String,
      required: true,
      maxlength: 16,
      validate: canonicalBase64(12),
    },
    tag: {
      type: String,
      required: true,
      maxlength: 24,
      validate: canonicalBase64(16),
    },
    ciphertext: {
      type: String,
      required: true,
      maxlength: 21_848,
      validate: canonicalBase64(),
    },
  },
  { _id: false, strict: "throw" },
);
