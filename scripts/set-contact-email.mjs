#!/usr/bin/env node
// ============================================================
//  npm run set-contact-email -- current@example.com new@example.com
//
//  Changes the EMAIL SHOWN on someone's profile (Admin -> People,
//  and anywhere else facultyName/email get displayed) without
//  touching how they actually sign in.
//
//  This matters specifically for the shared ID+password admin
//  account: it authenticates against a made-up address
//  (admin@nst-room-board.internal, see ADMIN_LOGIN_DOMAIN in
//  src/lib/firebase.ts) that nobody can actually receive mail at.
//  This script only edits the `email` field stored on the profile
//  document - a label - so admin/newtonschool@123 keeps logging in
//  exactly the same way afterward. Safe to use on any profile, not
//  just admin's.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const fromEmail = (process.argv[2] || "").trim().toLowerCase();
const toEmail = (process.argv[3] || "").trim().toLowerCase();

if (!fromEmail || !toEmail) {
  console.error("\n  Usage: npm run set-contact-email -- current@example.com new@example.com\n");
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();

async function main() {
  const snap = await db.collection("users").where("email", "==", fromEmail).get();

  if (snap.empty) {
    console.error("\n  No profile found with email " + fromEmail + "\n");
    process.exit(1);
  }

  for (const d of snap.docs) {
    await d.ref.update({ email: toEmail, updatedAt: Date.now() });
    console.log("\n  " + (d.data().name || fromEmail) + " now shows as " + toEmail + ".\n");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
