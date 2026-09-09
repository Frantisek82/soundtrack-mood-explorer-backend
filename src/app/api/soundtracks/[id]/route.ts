import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Soundtrack from "@/models/Soundtrack";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");

  try {
    const { id } = await context.params;

    await connectDB();

    const soundtrack = await Soundtrack.findById(id);

    if (!soundtrack) {
      return NextResponse.json(
        { message: "Soundtrack not found" },
        {
          status: 404,
          headers: getCorsHeaders(origin),
        },
      );
    }

    return NextResponse.json(soundtrack, {
      headers: getCorsHeaders(origin),
    });
  } catch {
    return NextResponse.json(
      { message: "Invalid soundtrack ID" },
      {
        status: 400,
        headers: getCorsHeaders(origin),
      },
    );
  }
}
