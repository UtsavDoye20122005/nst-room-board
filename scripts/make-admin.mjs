#!/usr/bin/env node
// ============================================================
//  npm run make-admin someone@newtonschool.co
//
//  Promotes an existing signed-in user to admin. Admins can
//  edit rooms, batches, and everyone's role, and can change or
//  cancel any booking - not only their own.
//
//  This is a script rather than a button on purpose: it means
//  nobody can make themselves an admin from the browser.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const email = (process.argv[2] || process.env.NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();

if (!email) {
  console.error("\n  Usage: npm run make-admin your.email@newtonschool.co\n");
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
    console.error(
      "\n  No profile found for " + email + "\n" +
      "  That person must sign in to the app once and finish the profile screen first.\n" +
      "  Then run this again.\n"
    );
    process.exit(1);
  }

  for (const d of snap.docs) {
    await d.ref.update({ role: "admin", updatedAt: Date.now() });
    console.log("\n  " + (d.data().name || email) + " is now an admin.\n");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
