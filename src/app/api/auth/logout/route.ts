import { NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/cors";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST() {
  const response = NextResponse.json(
    { message: "Logged out successfully" },
    { headers: CORS_HEADERS },
  );

  response.cookies.set({
    name: "token",
    value: "",
    expires: new Date(0),
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });

  return response;
}
