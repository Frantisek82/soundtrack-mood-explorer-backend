export type SpotifyConnectionStatusDto =
  | {
      state: "disconnected";
      account: null;
    }
  | {
      state: "connected" | "reauthorization_required";
      account: { displayName: string | null };
    };

export function toSpotifyConnectionStatus(
  connection: unknown,
): SpotifyConnectionStatusDto {
  if (connection === null) {
    return { state: "disconnected", account: null };
  }

  if (typeof connection !== "object" || Array.isArray(connection)) {
    throw new Error("Invalid Spotify connection status");
  }

  const source = connection as Record<string, unknown>;
  const state = source.status;

  if (state !== "connected" && state !== "reauthorization_required") {
    throw new Error("Invalid Spotify connection status");
  }

  const displayName = source.displayName ?? null;
  if (
    displayName !== null &&
    (typeof displayName !== "string" || displayName.length > 256)
  ) {
    throw new Error("Invalid Spotify connection status");
  }

  return {
    state,
    account: { displayName },
  };
}
