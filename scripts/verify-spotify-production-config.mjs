const failure = "Spotify production configuration: FAIL";

try {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.SPOTIFY_ENABLED !== "false"
  ) {
    throw new Error();
  }

  const { getSpotifyConfig } = await import("../src/lib/spotify/config.ts");

  // Validate the future enabled configuration without changing process.env.
  const config = getSpotifyConfig({
    ...process.env,
    SPOTIFY_ENABLED: "true",
  });

  if (!config.enabled || process.env.SPOTIFY_ENABLED !== "false") {
    throw new Error();
  }

  console.log("Spotify production configuration: PASS; OAuth remains disabled.");
} catch {
  // Never print configuration values, raw exceptions, or key material.
  console.error(failure);
  process.exitCode = 1;
}
