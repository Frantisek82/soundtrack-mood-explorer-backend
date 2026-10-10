import { describe, expect, it } from "vitest";

import type { SpotifyConfig } from "@/lib/spotify/config";
import {
  assertSpotifyMutationRequest,
  getSpotifyCorsHeaders,
  spotifyPreflightResponse,
  SpotifyRequestError,
} from "@/lib/spotify/requests";

const origin = "http://127.0.0.1:3001";

const config: SpotifyConfig = {
  enabled: true,
  clientId: "a".repeat(32),
  frontendOrigin: origin,
  redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
  encryptionKeys: new Map(),
  activeKeyId: "test",
};

function mutation(
  requestOrigin: string | null = origin,
  method = "POST",
  contentType: string | null = "application/json",
) {
  const headers = new Headers();
  if (requestOrigin !== null) headers.set("Origin", requestOrigin);
  if (contentType !== null) headers.set("Content-Type", contentType);

  return new Request("http://127.0.0.1:3000/api/spotify/connect", {
    method,
    headers,
  });
}

function preflight(method = "POST", requestedHeaders?: string) {
  const headers = new Headers({
    Origin: origin,
    "Access-Control-Request-Method": method,
  });
  if (requestedHeaders !== undefined) {
    headers.set("Access-Control-Request-Headers", requestedHeaders);
  }

  return new Request("http://127.0.0.1:3000/api/spotify/connect", {
    method: "OPTIONS",
    headers,
  });
}

function expectFailure(action: () => unknown, status: number, code: string) {
  let failure: unknown;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(SpotifyRequestError);
  expect(failure).toMatchObject({ status, code });
}

describe("Spotify mutation requests", () => {
  it("accepts an exact-origin JSON POST", () => {
    expect(() =>
      assertSpotifyMutationRequest(mutation(), config),
    ).not.toThrow();
  });

  it("accepts JSON with a charset parameter", () => {
    expect(() =>
      assertSpotifyMutationRequest(
        mutation(origin, "POST", "application/json; charset=utf-8"),
        config,
      ),
    ).not.toThrow();
  });

  it("accepts an exact-origin DELETE without a content type", () => {
    expect(() =>
      assertSpotifyMutationRequest(mutation(origin, "DELETE", null), config),
    ).not.toThrow();
  });

  it.each([
    null,
    "null",
    "http://localhost:3001",
    "http://127.0.0.1:3001/",
    "http://127.0.0.1:3002",
    "https://example.com",
    "https://soundtrack-mood-explorer-frontend-git-feature.vercel.app",
    "https://soundtrack-mood-explorer-frontend.vercel.app.evil.test",
  ])("rejects origin %s", (requestOrigin) => {
    expectFailure(
      () => assertSpotifyMutationRequest(mutation(requestOrigin), config),
      403,
      "origin_not_allowed",
    );
  });

  it.each([null, "text/plain", "application/x-www-form-urlencoded"])(
    "rejects POST content type %s",
    (contentType) => {
      expectFailure(
        () =>
          assertSpotifyMutationRequest(
            mutation(origin, "POST", contentType),
            config,
          ),
        415,
        "json_required",
      );
    },
  );

  it("rejects a non-mutation method", () => {
    expectFailure(
      () => assertSpotifyMutationRequest(mutation(origin, "GET"), config),
      405,
      "method_not_allowed",
    );
  });

  it.each(["disabled", "preview"] as const)(
    "rejects %s configuration",
    (reason) => {
      expectFailure(
        () =>
          assertSpotifyMutationRequest(mutation(), { enabled: false, reason }),
        503,
        "spotify_disabled",
      );
    },
  );
});

describe("Spotify CORS and preflight", () => {
  it("returns credentialed headers for the exact origin", () => {
    expect(getSpotifyCorsHeaders(mutation(), config)).toMatchObject({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
      "Cache-Control": "no-store",
    });
  });

  it("never falls back to production headers for a rejected origin", () => {
    expectFailure(
      () => getSpotifyCorsHeaders(mutation("https://example.com"), config),
      403,
      "origin_not_allowed",
    );
  });

  it.each(["GET", "POST", "DELETE"])(
    "accepts a %s preflight without application cookies",
    (method) => {
      const response = spotifyPreflightResponse(
        preflight(method, "CONTENT-TYPE"),
        config,
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
      expect(response.headers.get("Vary")).toBe(
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      );
    },
  );

  it("accepts a preflight without requested headers", () => {
    expect(spotifyPreflightResponse(preflight(), config).status).toBe(204);
  });

  it.each(["PATCH", "PUT", ""])("rejects requested method %s", (method) => {
    expectFailure(
      () => spotifyPreflightResponse(preflight(method), config),
      403,
      "preflight_method_not_allowed",
    );
  });

  it.each(["Authorization", "Content-Type, X-Custom", ""])(
    "rejects requested headers %s",
    (headers) => {
      expectFailure(
        () => spotifyPreflightResponse(preflight("POST", headers), config),
        403,
        "preflight_headers_not_allowed",
      );
    },
  );

  it("rejects preflight from an unapproved origin", () => {
    const req = preflight();
    req.headers.set("Origin", "https://example.com");

    expectFailure(
      () => spotifyPreflightResponse(req, config),
      403,
      "origin_not_allowed",
    );
  });

  it("rejects preflight when Spotify is disabled", () => {
    expectFailure(
      () =>
        spotifyPreflightResponse(preflight(), {
          enabled: false,
          reason: "disabled",
        }),
      503,
      "spotify_disabled",
    );
  });
});
