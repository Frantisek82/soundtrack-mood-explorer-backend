import { describe, expect, it } from "vitest";

import {
  parseSpotifyCallbackParameters,
  SpotifyCallbackParametersError,
} from "@/lib/spotify/callback-parameters";

const state = Buffer.alloc(32, 1).toString("base64url");

describe("Spotify callback parameters", () => {
  it("accepts one code and valid state", () => {
    expect(
      parseSpotifyCallbackParameters(
        new URLSearchParams({ state, code: "test-only-code" }),
      ),
    ).toEqual({
      kind: "authorized",
      state,
      code: "test-only-code",
    });
  });

  it("recognizes denial without returning provider text", () => {
    expect(
      parseSpotifyCallbackParameters(
        new URLSearchParams({
          state,
          error: "access_denied",
          error_description: "test-only-provider-description",
        }),
      ),
    ).toEqual({ kind: "denied", state });
  });

  it("maps other provider errors to a bounded result", () => {
    expect(
      parseSpotifyCallbackParameters(
        new URLSearchParams({ state, error: "server_error" }),
      ),
    ).toEqual({ kind: "provider_error", state });
  });

  it("ignores unique unrelated parameters without returning them", () => {
    expect(
      parseSpotifyCallbackParameters(
        new URLSearchParams({
          state,
          code: "test-only-code",
          next: "https://example.com",
        }),
      ),
    ).toEqual({
      kind: "authorized",
      state,
      code: "test-only-code",
    });
  });

  it.each([
    { code: "test-code" },
    { state: "invalid", code: "test-code" },
    { state },
    { state, code: "test-code", error: "access_denied" },
    { state, code: "" },
    { state, error: "" },
    { state, code: "contains whitespace" },
    { state, code: "a".repeat(4097) },
    { state, error: "a".repeat(129) },
    { state, error: "contains whitespace" },
  ])("rejects malformed callback parameters", (values) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      parameters.set(key, value);
    }

    expect(() => parseSpotifyCallbackParameters(parameters)).toThrow(
      SpotifyCallbackParametersError,
    );
  });

  it.each(["state", "code", "error", "next"])(
    "rejects duplicate %s parameters",
    (key) => {
      const parameters = new URLSearchParams(
        key === "error"
          ? { state, error: "access_denied" }
          : { state, code: "test-only-code" },
      );

      parameters.append(key, "duplicate");
      parameters.append(key, "another-duplicate");

      expect(() => parseSpotifyCallbackParameters(parameters)).toThrow(
        SpotifyCallbackParametersError,
      );
    },
  );

  it("rejects an oversized query", () => {
    const parameters = new URLSearchParams({
      state,
      code: "test-code",
      extra: "a".repeat(16_384),
    });

    expect(() => parseSpotifyCallbackParameters(parameters)).toThrow(
      SpotifyCallbackParametersError,
    );
  });
});
