// ============================================================
//  POST /api/auth/request-code
//
//  Step 1 of proving someone actually owns the college inbox they
//  typed. Only @newtonschool.co / @svyasa-sas.edu.in addresses can
//  ask for a code - anything else is refused before any email is
//  sent, so a random Gmail address can never get this far.
//
//  The code lives in Firestore (`otpCodes/<email>`) for 10 minutes.
//  Nothing in firestore.rules lets a client read or write that
//  collection - only this server route (via the Admin SDK, which
//  ignores rules) ever touches it.
// ============================================================

import { NextResponse } from "next/server";
import { adminConfigured, adminDb } from "@/lib/firebaseAdmin";
import { isAllowedEmail, allowedDomainsLabel } from "@/lib/firebase";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;

function makeCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, message: "The server is not fully set up yet (Firebase Admin credentials are missing)." },
      { status: 200 }
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, message: "Enter your email address." }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { ok: false, message: "Use your college account (" + allowedDomainsLabel() + "). Personal addresses cannot access the room board." },
      { status: 403 }
    );
  }

  const db = adminDb();
  const ref = db.collection("otpCodes").doc(email);
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data() as { createdAt: number };
    const waited = Date.now() - data.createdAt;
    if (waited < RESEND_COOLDOWN_MS) {
      return NextResponse.json(
        { ok: false, message: "Give it a few more seconds before asking for another code." },
        { status: 429 }
      );
    }
  }

  const code = makeCode();
  const now = Date.now();
  await ref.set({ email, code, attempts: 0, createdAt: now, expiresAt: now + CODE_TTL_MS });

  const result = await sendEmail({
    subject: "Your Room Board verification code",
    text:
      "Your verification code is " + code + "\n\n" +
      "It expires in 10 minutes. If you did not request this, ignore this email.\n\n" +
      "— NST Room Board",
    html:
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#121A19;max-width:480px;margin:0 auto;padding:8px">' +
      '<p style="margin:0 0 14px">Your verification code is:</p>' +
      '<p style="font-size:32px;font-weight:700;letter-spacing:.14em;margin:0 0 14px">' + code + "</p>" +
      '<p style="color:#5E6864;font-size:13px">It expires in 10 minutes. If you did not request this, ignore this email.</p>' +
      '<p style="color:#5E6864;font-size:12.5px;border-top:1px solid #D3D8D2;padding-top:12px;margin-top:22px">NST Room Board</p>' +
      "</div>",
    bcc: [email],
  });

  return NextResponse.json({
    ok: result.failed === 0,
    provider: result.provider,
    message:
      result.provider === "console"
        ? "Email is in test mode (EMAIL_PROVIDER=console) — the code was logged on the server instead of sent. Check the terminal running npm run dev."
        : result.failed === 0
          ? "Code sent — check your inbox (and your spam/junk folder if it doesn't show up in a minute)."
          : "Could not send the email: " + (result.errors[0] || "unknown error"),
  });
}
