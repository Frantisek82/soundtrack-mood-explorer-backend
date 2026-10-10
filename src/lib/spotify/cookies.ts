import { randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";

import type { SpotifyConfig } from "./config";

type EnabledSpotifyConfig = Extract<SpotifyConfig, { enabled: true }>;

export const SPOTIFY_TRANSACTION_COOKIE = "spotify_oauth";
export const SPOTIFY_TRANSACTION_TTL_SECONDS = 10 * 60;

export function createSpotifyBrowserBinding(): string {
  return randomBytes(32).toString("base64url");
}

function cookieOptions(config: EnabledSpotifyConfig) {
  return {
    name: SPOTIFY_TRANSACTION_COOKIE,
    httpOnly: true,
    secure: new URL(config.redirectUri).protocol === "https:",
    sameSite: "lax" as const,
    path: "/api/spotify",
  };
}

export function setSpotifyTransactionCookie(
  response: NextResponse,
  binding: string,
  config: EnabledSpotifyConfig,
): void {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(binding) ||
    Buffer.from(binding, "base64url").toString("base64url") !== binding
  ) {
    throw new Error("Invalid Spotify browser binding");
  }

  response.cookies.set({
    ...cookieOptions(config),
    value: binding,
    maxAge: SPOTIFY_TRANSACTION_TTL_SECONDS,
  });
}

export function clearSpotifyTransactionCookie(
  response: NextResponse,
  config: EnabledSpotifyConfig,
): void {
  response.cookies.set({
    ...cookieOptions(config),
    value: "",
    maxAge: 0,
    expires: new Date(0),
  });
}
