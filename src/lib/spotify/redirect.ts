import type { SpotifyConfig } from "./config";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

export const SPOTIFY_CALLBACK_RESULTS = [
  "connected",
  "denied",
  "invalid_transaction",
  "session_expired",
  "account_conflict",
  "provider_error",
] as const;

export type SpotifyCallbackResult = (typeof SPOTIFY_CALLBACK_RESULTS)[number];

export function spotifyCallbackResultUrl(
  config: EnabledSpotifyConfig,
  result: SpotifyCallbackResult,
): string {
  if (!SPOTIFY_CALLBACK_RESULTS.includes(result)) {
    throw new Error("Invalid Spotify callback result");
  }

  const url = new URL("/profile", config.frontendOrigin);
  url.searchParams.set("spotify", result);
  return url.toString();
}
