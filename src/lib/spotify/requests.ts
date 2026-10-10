import type { SpotifyConfig } from "./config";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

export class SpotifyRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "SpotifyRequestError";
  }
}

function requireEnabled(
  config: SpotifyConfig,
): asserts config is EnabledSpotifyConfig {
  if (!config.enabled) {
    throw new SpotifyRequestError(503, "spotify_disabled");
  }
}

function requireOrigin(req: Request, config: EnabledSpotifyConfig) {
  if (req.headers.get("origin") !== config.frontendOrigin) {
    throw new SpotifyRequestError(403, "origin_not_allowed");
  }
}

export function assertSpotifyMutationRequest(
  req: Request,
  config: SpotifyConfig,
): asserts config is EnabledSpotifyConfig {
  requireEnabled(config);
  requireOrigin(req, config);

  if (req.method !== "POST" && req.method !== "DELETE") {
    throw new SpotifyRequestError(405, "method_not_allowed");
  }

  if (req.method === "POST") {
    const mediaType = req.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();

    if (mediaType !== "application/json") {
      throw new SpotifyRequestError(415, "json_required");
    }
  }
}

export function getSpotifyCorsHeaders(
  req: Request,
  config: SpotifyConfig,
): Record<string, string> {
  requireEnabled(config);
  requireOrigin(req, config);

  return {
    "Access-Control-Allow-Origin": config.frontendOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

export function spotifyPreflightResponse(
  req: Request,
  config: SpotifyConfig,
): Response {
  const headers = getSpotifyCorsHeaders(req, config);

  if (req.method !== "OPTIONS") {
    throw new SpotifyRequestError(405, "method_not_allowed");
  }

  const requestedMethod = req.headers.get("access-control-request-method");
  if (
    !requestedMethod ||
    !["GET", "POST", "DELETE"].includes(requestedMethod)
  ) {
    throw new SpotifyRequestError(403, "preflight_method_not_allowed");
  }

  const requestedHeaders = req.headers.get("access-control-request-headers");
  if (
    requestedHeaders !== null &&
    requestedHeaders
      .split(",")
      .some((header) => header.trim().toLowerCase() !== "content-type")
  ) {
    throw new SpotifyRequestError(403, "preflight_headers_not_allowed");
  }

  headers.Vary =
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";

  return new Response(null, { status: 204, headers });
}
