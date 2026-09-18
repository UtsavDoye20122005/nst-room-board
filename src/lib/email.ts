// ============================================================
//  Sending mail, server side only.
//
//  Three providers, chosen with EMAIL_PROVIDER in .env.local:
//
//    console  (default) - writes the message to the server log and
//                         reports success. Nothing is sent. Use this
//                         while developing so nothing ever breaks.
//    gmail              - your Gmail account plus a 16-character App
//                         Password. Free, roughly 500 recipients/day.
//    brevo              - Brevo (ex-Sendinblue) HTTP API. Free tier is
//                         300 emails/day and needs no domain of your own.
//
//  Sending NEVER throws upward into a booking action. If mail fails,
//  the room change still happened and students still see it in the
//  app. The API route reports the failure so the UI can say so.
// ============================================================

import nodemailer from "nodemailer";

export type EmailProvider = "console" | "gmail" | "brevo";

export interface OutgoingEmail {
  subject: string;
  text: string;
  html: string;
  /** Everyone is BCC'd so students never see each other's addresses. */
  bcc: string[];
}

export interface SendResult {
  provider: EmailProvider;
  attempted: number;
  sent: number;
  failed: number;
  errors: string[];
}

/** Brevo caps a single call; Gmail is happier in modest chunks too. */
const CHUNK_SIZE = 45;

function provider(): EmailProvider {
  const p = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  return p === "gmail" || p === "brevo" ? p : "console";
}

function fromName(): string {
  return process.env.EMAIL_FROM_NAME || "NST Room Board";
}

function fromAddress(): string {
  return (
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.GMAIL_USER ||
    "no-reply@example.com"
  );
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function sendEmail(mail: OutgoingEmail): Promise<SendResult> {
  const p = provider();
  const recipients = Array.from(new Set(mail.bcc.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))));
  const result: SendResult = { provider: p, attempted: recipients.length, sent: 0, failed: 0, errors: [] };

  if (recipients.length === 0) return result;

  if (p === "console") {
    console.log(
      "[room-board] EMAIL_PROVIDER=console, nothing sent.\n" +
        "  to      : " + recipients.length + " recipient(s)\n" +
        "  subject : " + mail.subject + "\n" +
        "  body    :\n" + mail.text.split("\n").map((l) => "    " + l).join("\n")
    );
    result.sent = recipients.length;
    return result;
  }

  for (const group of chunk(recipients, CHUNK_SIZE)) {
    try {
      if (p === "gmail") await sendViaGmail(mail, group);
      else await sendViaBrevo(mail, group);
      result.sent += group.length;
    } catch (e) {
      result.failed += group.length;
      const msg = e instanceof Error ? e.message : String(e);
      if (!result.errors.includes(msg)) result.errors.push(msg);
    }
  }
  return result;
}

async function sendViaGmail(mail: OutgoingEmail, bcc: string[]): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("EMAIL_PROVIDER=gmail but GMAIL_USER or GMAIL_APP_PASSWORD is missing.");
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await transport.sendMail({
    from: '"' + fromName() + '" <' + user + ">",
    to: user, // a copy to the sender keeps Gmail happy about BCC-only mail
    bcc,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

async function sendViaBrevo(mail: OutgoingEmail, bcc: string[]): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("EMAIL_PROVIDER=brevo but BREVO_API_KEY is missing.");

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: fromName(), email: fromAddress() },
      to: [{ email: fromAddress(), name: fromName() }],
      bcc: bcc.map((email) => ({ email })),
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error("Brevo returned " + res.status + ": " + body.slice(0, 300));
  }
}

// ------------------------------------------------------------
//  Message templates
// ------------------------------------------------------------

// The booking-notification templates used to live here. Nothing mails
// students or teachers about a booking any more - the board shows the
// change and Slack announces it - so they are gone. What is left is the
// one-time sign-in code, which is the only mail this app still sends.
