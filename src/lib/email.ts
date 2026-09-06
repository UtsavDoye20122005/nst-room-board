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

export interface TemplateInput {
  kind: "booked" | "cancelled" | "moved" | "reinstated";
  subject: string;
  title: string;
  facultyName: string;
  roomName: string;
  roomNote: string;
  previousRoomName?: string;
  dateLabel: string;
  timeLabel: string;
  batchLabel: string;
  note: string;
  reason: string;
}

export function buildEmail(t: TemplateInput): { subject: string; text: string; html: string } {
  let subject: string;
  let headline: string;
  let lead: string;
  let action: string;

  const where = t.roomName + (t.roomNote ? " (" + t.roomNote + ")" : "");

  switch (t.kind) {
    case "cancelled":
      subject = "Cancelled: " + t.subject + " on " + t.dateLabel;
      headline = "Class cancelled";
      lead = t.subject + " (" + t.title + ") with " + t.facultyName + ", scheduled for " +
        t.dateLabel + " at " + t.timeLabel + " in " + where + ", has been cancelled.";
      action = "The room is free again for that slot. Let your students know.";
      break;
    case "moved":
      subject = "Room change: " + t.subject + " is now in " + t.roomName;
      headline = "Room change";
      lead = t.subject + " (" + t.title + ") with " + t.facultyName + " on " + t.dateLabel +
        " at " + t.timeLabel + " has moved" +
        (t.previousRoomName ? " from " + t.previousRoomName : "") + " to " + where + ".";
      action = "Let your students know it's now in " + t.roomName + ", not the earlier room.";
      break;
    case "reinstated":
      subject = "Back on: " + t.subject + " on " + t.dateLabel;
      headline = "Session reinstated";
      lead = t.subject + " (" + t.title + ") with " + t.facultyName + " on " + t.dateLabel +
        " at " + t.timeLabel + " is going ahead after all, in " + where + ".";
      action = "Let your students know it's back on, in " + t.roomName + " as normal.";
      break;
    default:
      subject = t.subject + " — " + t.roomName + ", " + t.dateLabel;
      headline = "Session scheduled";
      lead = t.subject + " (" + t.title + ") with " + t.facultyName + " is scheduled for " +
        t.dateLabel + " at " + t.timeLabel + " in " + where + ".";
      action = "Now live on the room board.";
  }

  const lines = [
    "Hi,",
    "",
    lead,
    t.reason ? "Reason: " + t.reason : "",
    t.note ? "Note from the faculty: " + t.note : "",
    "",
    action,
    "",
    "Batches: " + t.batchLabel,
    "",
    "NST Room Board — sent to faculty and admin only. Students hear about this on Slack.",
  ].filter((l) => l !== "");

  const text = lines.join("\n");

  const accent = t.kind === "cancelled" ? "#B3382C" : t.kind === "moved" ? "#2B5FA8" : "#0B6B62";

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#121A19;max-width:560px;margin:0 auto;padding:8px">' +
    '<div style="border-left:4px solid ' + accent + ';padding:2px 0 2px 14px;margin-bottom:18px">' +
    '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:' + accent + ';font-weight:700">' + esc(headline) + "</div>" +
    '<div style="font-size:19px;font-weight:600;margin-top:3px">' + esc(t.subject) + " — " + esc(t.title) + "</div>" +
    "</div>" +
    "<p>Hi,</p>" +
    "<p>" + esc(lead) + "</p>" +
    (t.reason ? '<p style="margin:0 0 12px"><strong>Reason:</strong> ' + esc(t.reason) + "</p>" : "") +
    (t.note ? '<p style="margin:0 0 12px"><strong>Note from the faculty:</strong> ' + esc(t.note) + "</p>" : "") +
    '<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #D3D8D2;border-radius:6px;margin:18px 0">' +
    row("Room", where) +
    row("Date", t.dateLabel) +
    row("Time", t.timeLabel) +
    row("Faculty", t.facultyName) +
    row("Batches", t.batchLabel) +
    "</table>" +
    '<p style="font-weight:600">' + esc(action) + "</p>" +
    '<p style="color:#5E6864;font-size:12.5px;border-top:1px solid #D3D8D2;padding-top:12px;margin-top:22px">' +
    "Sent automatically by the NST Room Board to faculty and admin only — students hear about this on Slack. The live board always shows the current schedule." +
    "</p></div>";

  return { subject, text, html };
}

function row(label: string, value: string): string {
  return (
    '<tr><td style="padding:9px 14px;border-bottom:1px solid #E4E8E3;font-size:11px;letter-spacing:.1em;' +
    'text-transform:uppercase;color:#5E6864;width:96px;vertical-align:top">' + esc(label) + "</td>" +
    '<td style="padding:9px 14px;border-bottom:1px solid #E4E8E3">' + esc(value) + "</td></tr>"
  );
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
