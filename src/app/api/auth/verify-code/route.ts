// ============================================================
//  POST /api/auth/verify-code
//
//  Step 2: the person types the code back. If it matches, that
//  proves they can read mail sent to that exact college address -
//  which a typed-in email address alone never proves.
//
//  On success we mint a Firebase custom token for that email's
//  account (creating the account the first time) and hand it back.
//  The browser then calls signInWithCustomToken(token) - the normal
//  Firebase Auth session that follows works exactly like a Google
//  sign-in from then on, including firestore.rules and every other
//  check in the app.
// ============================================================

import { NextResponse } from "next/server";
import { adminAuth, adminConfigured, adminDb } from "@/lib/firebaseAdmin";
import { isAllowedEmail, allowedDomainsLabel } from "@/lib/firebase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, message: "The server is not fully set up yet (Firebase Admin credentials are missing)." },
      { status: 200 }
    );
  }

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const code = (body.code || "").trim();
  if (!email || !code) {
    return NextResponse.json({ ok: false, message: "Enter the code from your email." }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { ok: false, message: "Use your college account (" + allowedDomainsLabel() + ")." },
      { status: 403 }
    );
  }

  const db = adminDb();
  const ref = db.collection("otpCodes").doc(email);
  const snap = await ref.get();

  if (!snap.exists) {
    return NextResponse.json({ ok: false, message: "Request a new code first." }, { status: 400 });
  }

  const data = snap.data() as { code: string; attempts: number; expiresAt: number };

  if (Date.now() > data.expiresAt) {
    await ref.delete();
    return NextResponse.json({ ok: false, message: "That code expired. Request a new one." }, { status: 400 });
  }

  if (data.attempts >= MAX_ATTEMPTS) {
    await ref.delete();
    return NextResponse.json({ ok: false, message: "Too many wrong attempts. Request a new code." }, { status: 429 });
  }

  if (data.code !== code) {
    await ref.update({ attempts: data.attempts + 1 });
    const left = MAX_ATTEMPTS - data.attempts - 1;
    return NextResponse.json(
      { ok: false, message: "That code is wrong." + (left > 0 ? " " + left + " attempt(s) left." : " Request a new code.") },
      { status: 400 }
    );
  }

  // Correct - this address is verified. Single-use: remove it now.
  await ref.delete();

  const auth = adminAuth();
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    if (!existing.emailVerified) await auth.updateUser(uid, { emailVerified: true });
  } catch {
    const created = await auth.createUser({ email, emailVerified: true });
    uid = created.uid;
  }

  const token = await auth.createCustomToken(uid);
  return NextResponse.json({ ok: true, token });
}
