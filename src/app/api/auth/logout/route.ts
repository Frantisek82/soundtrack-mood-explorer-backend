import { NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return NextResponse.json({}, {
    headers: getCorsHeaders(origin),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  const response = NextResponse.json(
    { message: "Logged out successfully" },
    { headers: getCorsHeaders(origin) },
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