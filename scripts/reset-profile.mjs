#!/usr/bin/env node
// ============================================================
//  npm run reset-profile someone@example.com
//
//  Deletes that email's profile document from `users`, so the next
//  time they sign in the app treats them as brand new and sends them
//  through onboarding again from scratch (role, name, years/batch -
//  everything). Useful while testing with the same handful of email
//  addresses over and over.
//
//  Does NOT touch their Firebase Auth account (they keep the same
//  uid and can sign back in the same way), and does NOT touch any
//  bookings they made as faculty - only the profile doc.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const email = (process.argv[2] || "").trim().toLowerCase();

if (!email) {
  console.error("\n  Usage: npm run reset-profile someone@example.com\n");
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
  const snap = await db.collection("users").where("email", "==", email).get();

  if (snap.empty) {
    console.log("\n  No profile found for " + email + " - nothing to remove.\n  They will get the fresh onboarding form on their next sign-in anyway.\n");
    process.exit(0);
  }

  for (const d of snap.docs) {
    console.log("  Deleting users/" + d.id + " (" + (d.data().name || "no name") + ", role: " + d.data().role + ")");
    await d.ref.delete();
  }

  console.log("\n  Done. " + email + " will see the onboarding form again next time they sign in.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
