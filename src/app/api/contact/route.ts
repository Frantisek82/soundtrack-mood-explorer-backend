import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  try {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const contactEmail = process.env.CONTACT_EMAIL?.trim();

    if (!apiKey || !contactEmail) {
      throw new Error("Contact delivery unavailable");
    }

    const resend = new Resend(apiKey);

    const { name, email, subject, message } = await req.json();

    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        {
          message: "All fields are required.",
        },
        {
          status: 400,
          headers: getCorsHeaders(origin),
        },
      );
    }

    const { data, error } = await resend.emails.send({
      from: "Portfolio Contact <onboarding@resend.dev>",
      to: contactEmail,

      subject: `Portfolio Contact: ${subject}`,

      replyTo: email,

      text: `
New message from your portfolio website

----------------------------------------

Name:
${name}

Email:
${email}

Subject:
${subject}

----------------------------------------

${message}
`,
    });

    if (
      error ||
      typeof data?.id !== "string" ||
      data.id.trim().length === 0
    ) {
      throw new Error("Contact delivery unavailable");
    }

    return NextResponse.json(
      {
        message: "Message received.",
      },
      {
        headers: getCorsHeaders(origin),
      },
    );
  } catch {
    console.error("Contact request failed");

    return NextResponse.json(
      {
        message: "Failed to send message.",
      },
      {
        status: 500,
        headers: getCorsHeaders(origin),
      },
    );
  }
}
