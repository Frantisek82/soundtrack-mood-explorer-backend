import { describe, expect, it } from "vitest";

import {
  DeletionHistoryConfigError,
  getDeletionIdentityConfig,
} from "@/lib/deletion-history/config";

const key = Buffer.alloc(32, 7).toString("base64");
const env = {
  DELETION_HISTORY_NAMESPACE: "synthetic-test",
  DELETION_HISTORY_ACTIVE_KEY_VERSION: "test-v1",
  DELETION_HISTORY_HMAC_KEYS: JSON.stringify({
    "test-v1": key,
    "test-v0": Buffer.alloc(32, 8).toString("base64"),
  }),
};

describe("Deletion-history identity configuration", () => {
  it("loads the active key and preserves older keys for matching", () => {
    const config = getDeletionIdentityConfig(env);
    expect(config.namespace).toBe("synthetic-test");
    expect(config.activeKeyVersion).toBe("test-v1");
    expect(config.keys.size).toBe(2);
    expect(config.keys.get("test-v1")).toEqual(Buffer.alloc(32, 7));
    expect(config.keys.get("test-v0")).toEqual(Buffer.alloc(32, 8));
  });

  it.each(Object.keys(env))("rejects missing %s without a fallback", name => {
    expect(() => getDeletionIdentityConfig({ ...env, [name]: undefined }))
      .toThrow(DeletionHistoryConfigError);
  });

  it.each(["", " leading", "trailing ", "a/b", "a".repeat(65)])(
    "rejects invalid namespace or active version %j",
    value => {
      for (const name of [
        "DELETION_HISTORY_NAMESPACE",
        "DELETION_HISTORY_ACTIVE_KEY_VERSION",
      ]) {
        expect(() => getDeletionIdentityConfig({ ...env, [name]: value }))
          .toThrow(DeletionHistoryConfigError);
      }
    },
  );

  it.each([
    "private-malformed-keyring",
    "null",
    "[]",
    "{}",
    JSON.stringify({ "test-v1": 123 }),
    JSON.stringify({ "bad/version": key, "test-v1": key }),
    JSON.stringify({ "test-v1": Buffer.alloc(31).toString("base64") }),
    JSON.stringify({ "test-v1": Buffer.alloc(33).toString("base64") }),
    JSON.stringify({ "test-v1": key.replace(/=+$/, "") }),
    JSON.stringify({ "test-v1": key + "\\n" }),
    JSON.stringify({ "test-v0": key }),
  ])("rejects invalid keyrings with a sanitized error", value => {
    expect(() => getDeletionIdentityConfig({
      ...env,
      DELETION_HISTORY_HMAC_KEYS: value,
    })).toThrow("Invalid deletion-history configuration");
  });

  it("does not accept a malformed inactive key", () => {
    expect(() => getDeletionIdentityConfig({
      ...env,
      DELETION_HISTORY_HMAC_KEYS: JSON.stringify({
        "test-v1": key,
        "test-v0": "private-invalid-old-key",
      }),
    })).toThrow(DeletionHistoryConfigError);
  });
});
