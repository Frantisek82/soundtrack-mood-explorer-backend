import { NextResponse } from "next/server";
import type { Soundtrack } from "@/types/soundtrack";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}