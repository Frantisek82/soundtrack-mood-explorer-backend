import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { OPTIONS, POST } from "@/app/api/contact/route";

const origin = "http://127.0.0.1:3001";
const input = {
  name: "Test Contact User",
  email: "sender@example.test",
  subject: "Test enquiry",
  message: "Test-only contact message.",
};

function request(body: unknown = input) {
  return new Request("http://127.0.0.1:3000/api/contact", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function expectCors(response: Response) {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
}

async function expectFailure(response: Response) {
  expect(response.status).toBe(500);
  expectCors(response);
  await expect(response.json()).resolves.toEqual({
    message: "Failed to send message.",
  });
  expect(console.error).toHaveBeenCalledExactlyOnceWith("Contact request failed");
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_only_not_a_real_key");
    vi.stubEnv("CONTACT_EMAIL", "maintainer@example.test");
    sendMock.mockReset();
    sendMock.mockResolvedValue({
      data: { id: "test-only-message-id" },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Live HTTP is forbidden in this test"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("preserves the success response after provider acceptance", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expectCors(response);
    await expect(response.json()).resolves.toEqual({
      message: "Message received.",
    });
    expect(sendMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        from: "Portfolio Contact <onboarding@resend.dev>",
        to: "maintainer@example.test",
        replyTo: input.email,
        subject: `Portfolio Contact: ${input.subject}`,
        text: expect.stringContaining(input.message),
      }),
    );
    expect(console.error).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not report success for a returned provider error", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        message: "private provider rejection and recipient information",
      },
    });

    await expectFailure(await POST(request()));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an error even when an acceptance ID is also present", async () => {
    sendMock.mockResolvedValue({
      data: { id: "test-only-message-id" },
      error: { message: "private inconsistent provider result" },
    });

    await expectFailure(await POST(request()));
  });

  it("sanitizes thrown failures without retrying", async () => {
    sendMock.mockRejectedValue(
      new Error("private credentials, recipient, and message details"),
    );

    await expectFailure(await POST(request()));
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: null, error: null },
    { data: {}, error: null },
    { data: { id: null }, error: null },
    { data: { id: 42 }, error: null },
    { data: { id: "" }, error: null },
    { data: { id: "   " }, error: null },
  ])("rejects a missing or invalid acceptance ID", async result => {
    sendMock.mockResolvedValue(result);
    await expectFailure(await POST(request()));
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["RESEND_API_KEY", undefined],
    ["RESEND_API_KEY", ""],
    ["RESEND_API_KEY", "   "],
    ["CONTACT_EMAIL", undefined],
    ["CONTACT_EMAIL", ""],
    ["CONTACT_EMAIL", "   "],
  ] as const)("rejects missing configuration: %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    await expectFailure(await POST(request()));
    expect(sendMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["name", "email", "subject", "message"] as const)(
    "preserves validation for a missing %s",
    async field => {
      const response = await POST(request({ ...input, [field]: "" }));

      expect(response.status).toBe(400);
      expectCors(response);
      await expect(response.json()).resolves.toEqual({
        message: "All fields are required.",
      });
      expect(sendMock).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it("returns a sanitized failure for malformed JSON", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/contact", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{",
      }),
    );

    await expectFailure(response);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("preserves approved preflight without contacting Resend", async () => {
    const response = await OPTIONS(
      new Request("http://127.0.0.1:3000/api/contact", {
        method: "OPTIONS",
        headers: { Origin: origin },
      }),
    );

    expect(response.status).toBe(204);
    expectCors(response);
    expect(await response.text()).toBe("");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
