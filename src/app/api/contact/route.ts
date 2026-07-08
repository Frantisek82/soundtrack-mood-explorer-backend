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
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not configured.");
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

    await resend.emails.send({
      from: "Portfolio Contact <onboarding@resend.dev>",
      to: process.env.CONTACT_EMAIL!,

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

    return NextResponse.json(
      {
        message: "Message received.",
      },
      {
        headers: getCorsHeaders(origin),
      },
    );
  } catch (error) {
    console.error(error);

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
