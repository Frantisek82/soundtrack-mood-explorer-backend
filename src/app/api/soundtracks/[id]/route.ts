import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";
import { CORS_HEADERS } from "@/lib/cors";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    await connectDB();

    const soundtrack = await Soundtrack.findById(id);

    if (!soundtrack) {
      return NextResponse.json(
        { message: "Soundtrack not found" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json(soundtrack, {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "Invalid soundtrack ID" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
}
