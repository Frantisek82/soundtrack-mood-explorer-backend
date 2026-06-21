export const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.NODE_ENV === "production"
      ? "https://soundtrack-mood-explorer-frontend.vercel.app"
      : "http://localhost:3001",

  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",

  "Access-Control-Allow-Headers": "Content-Type, Authorization",

  "Access-Control-Allow-Credentials": "true",
};

export function getCorsHeaders(origin?: string | null) {
  const allowedOrigins = [
    "http://localhost:3001",
    "https://soundtrack-mood-explorer-frontend.vercel.app",
  ];

  const isPreviewDeployment =
    !!origin &&
    origin.endsWith(".vercel.app") &&
    origin.includes("soundtrack-mood-explorer-frontend");

  const allowedOrigin =
    origin &&
    (allowedOrigins.includes(origin) || isPreviewDeployment)
      ? origin
      : allowedOrigins[1];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}