import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import { getCorsHeaders } from "@/lib/cors";

/**
 * Preflight
 */
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/**
 * Get authenticated user ID from cookies
 */
async function getUserIdFromCookies(): Promise<string> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    throw new Error("Unauthorized");
  }

  const decoded = verifyToken(token);

  return decoded.id;
}
