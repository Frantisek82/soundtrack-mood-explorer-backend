import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { SpotifyConfig } from "./config";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

export type CredentialPurpose =
  | "access_token"
  | "refresh_token"
  | "pkce_verifier";

export type CredentialContext = {
  userId: string;
  generation: number;
  purpose: CredentialPurpose;
};

export type EncryptedSpotifyCredential = {
  version: 1;
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

const MAX_CREDENTIAL_BYTES = 16_384;
const MAX_ENCODED_LENGTH = Math.ceil(MAX_CREDENTIAL_BYTES / 3) * 4;
const FAILURE = "Spotify credential operation failed";

function additionalData(context: CredentialContext, keyId: string): Buffer {
  if (
    !/^[a-f0-9]{24}$/.test(context.userId) ||
    !Number.isSafeInteger(context.generation) ||
    context.generation < 0 ||
    !["access_token", "refresh_token", "pkce_verifier"].includes(
      context.purpose,
    )
  ) {
    throw new Error(FAILURE);
  }

  return Buffer.from(
    JSON.stringify([
      "spotify-credential",
      1,
      keyId,
      context.userId,
      context.generation,
      context.purpose,
    ]),
    "utf8",
  );
}

function keyFor(config: EnabledSpotifyConfig, keyId: string): Buffer {
  if (!config.enabled || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) {
    throw new Error(FAILURE);
  }

  const key = config.encryptionKeys.get(keyId);
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error(FAILURE);
  }

  return key;
}

function decode(value: unknown, expectedLength?: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ENCODED_LENGTH
  ) {
    throw new Error(FAILURE);
  }

  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    decoded.length === 0 ||
    decoded.length > MAX_CREDENTIAL_BYTES ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new Error(FAILURE);
  }

  return decoded;
}

export function encryptSpotifyCredential(
  value: string,
  context: CredentialContext,
  config: EnabledSpotifyConfig,
): EncryptedSpotifyCredential {
  try {
    if (typeof value !== "string") {
      throw new Error(FAILURE);
    }

    const plaintext = Buffer.from(value, "utf8");
    if (
      plaintext.length === 0 ||
      plaintext.length > MAX_CREDENTIAL_BYTES ||
      plaintext.toString("utf8") !== value
    ) {
      throw new Error(FAILURE);
    }

    const keyId = config.activeKeyId;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyFor(config, keyId), iv, {
      authTagLength: 16,
    });
    cipher.setAAD(additionalData(context, keyId));

    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    return {
      version: 1,
      keyId,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } catch {
    throw new Error(FAILURE);
  }
}

export function decryptSpotifyCredential(
  envelope: unknown,
  context: CredentialContext,
  config: EnabledSpotifyConfig,
): string {
  try {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new Error(FAILURE);
    }

    const stored = envelope as Partial<EncryptedSpotifyCredential>;
    if (stored.version !== 1 || typeof stored.keyId !== "string") {
      throw new Error(FAILURE);
    }

    const iv = decode(stored.iv, 12);
    const tag = decode(stored.tag, 16);
    const ciphertext = decode(stored.ciphertext);

    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(config, stored.keyId),
      iv,
      { authTagLength: 16 },
    );
    decipher.setAAD(additionalData(context, stored.keyId));
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return plaintext.toString("utf8");
  } catch {
    throw new Error(FAILURE);
  }
}
