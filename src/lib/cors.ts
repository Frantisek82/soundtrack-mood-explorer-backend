export const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.NODE_ENV === "production"
      ? "https://soundtrack-mood-explorer-frontend.vercel.app"
      : "http://localhost:3001",

  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",

  "Access-Control-Allow-Headers": "Content-Type, Authorization",

  "Access-Control-Allow-Credentials": "true",
};
