import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createDeletionIdentifier,
  DeletionIdentifierError,
} from "@/lib/deletion-history/identifier";

const userId = "0123456789abcdef01234567";
const context = {
  namespace: "synthetic-test",
  keyVersion: "test-v1",
  key: Buffer.alloc(32, 7),
};

describe("Deletion-history identifiers", () => {
  it("uses the specified versioned encoding and SHA-256 HMAC", () => {
    const message =
      '["sme-account-deletion",1,"synthetic-test","test-v1","0123456789abcdef01234567"]';
    const expected = createHmac("sha256", context.key)
      .update(message, "utf8")
      .digest("hex");

    expect(createDeletionIdentifier(userId, context)).toBe(expected);
    expect(createDeletionIdentifier(userId, context)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic without mutating the supplied key", () => {
    const before = Buffer.from(context.key);
    const first = createDeletionIdentifier(userId, context);

    expect(createDeletionIdentifier(userId, context)).toBe(first);
    expect(context.key).toEqual(before);
  });

  it("separates users, datasets, key versions, and keys", () => {
    const results = [
      createDeletionIdentifier(userId, context),
      createDeletionIdentifier("1123456789abcdef01234567", context),
      createDeletionIdentifier(userId, { ...context, namespace: "another-test" }),
      createDeletionIdentifier(userId, { ...context, keyVersion: "test-v2" }),
      createDeletionIdentifier(userId, { ...context, key: Buffer.alloc(32, 8) }),
    ];

    expect(new Set(results).size).toBe(results.length);
  });

  it.each([
    "",
    "ABCDEF0123456789abcdef0123",
    "0123456789abcdef0123456",
    "0123456789abcdef012345678",
    " 0123456789abcdef01234567",
    "private-invalid-user-id",
  ])("rejects a noncanonical User ID without echoing it", value => {
    expect(() => createDeletionIdentifier(value, context))
      .toThrow(DeletionIdentifierError);
    expect(() => createDeletionIdentifier(value, context))
      .toThrow("Invalid deletion identifier input");
  });

  it.each(["", " leading", "trailing ", "a/b", "a".repeat(65)])(
    "rejects invalid namespace or key version %j",
    value => {
      expect(() => createDeletionIdentifier(userId, {
        ...context, namespace: value,
      })).toThrow(DeletionIdentifierError);
      expect(() => createDeletionIdentifier(userId, {
        ...context, keyVersion: value,
      })).toThrow(DeletionIdentifierError);
    },
  );

  it.each([0, 16, 31, 33, 64])("rejects a %i-byte key", length => {
    expect(() => createDeletionIdentifier(userId, {
      ...context, key: Buffer.alloc(length),
    })).toThrow(DeletionIdentifierError);
  });
});
