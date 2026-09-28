import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/soundtracks/[id]/route";

const origin = "http://localhost:3001";

function createRequest(id: string) {
  return {
    request: new Request(`http://localhost/api/soundtracks/${id}`, {
      headers: { Origin: origin },
    }),
    context: { params: Promise.resolve({ id }) },
  };
}

describe("GET /api/soundtracks/[id] error responses", () => {
  it("returns the existing 400 response for an invalid ObjectId", async () => {
    const { request, context } = createRequest("invalid-id");

    const response = await GET(request, context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid soundtrack ID",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  it("returns the existing 404 response for a missing soundtrack", async () => {
    const { request, context } = createRequest(
      new mongoose.Types.ObjectId().toString(),
    );

    const response = await GET(request, context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Soundtrack not found",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });
});
