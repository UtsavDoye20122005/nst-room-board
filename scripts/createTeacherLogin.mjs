#!/usr/bin/env node
// ============================================================
//  npm run create-teacher-login -- <id> <password> "<Name>"
//
//  Creates (or updates) a teacher login that needs no newtonschool.co
//  inbox and no OTP step - just an ID and a password, from the ID +
//  password form on the login page (the same mechanism the shared
//  admin login already uses, see createAdminLogin.mjs and
//  src/lib/firebase.ts's idLoginEmail()).
//
//  Example:
//    npm run create-teacher-login -- shubham.sagar "shubhamsagar@123" "Shubham Sagar"
//
//  Subjects and years aren't asked for here - leave them unset and
//  fix them later from Admin -> People -> Edit subjects, whenever
//  you're ready. Until then, that person's Subject field on a
//  booking is just a free-text box instead of a dropdown (no
//  dropdown to build without a subject list) - everything else
//  works exactly the same.
//
//  Safe to run again for the same id - it updates the password and
//  name instead of failing, and never touches subjects/years that
//  were already set some other way (e.g. from Admin -> People).
//  This sets the Firestore profile directly (role: faculty), so
//  whoever signs in lands straight on a working board - no
//  onboarding form, since there's no real inbox behind this account
//  for onboarding to make sense of.
//
//  Store the name WITHOUT a "Sir"/"Mam" suffix (e.g. "Ashwin", not
//  "Ashwin Sir") - the Admin -> Timetable dropdown adds that itself
//  for display, so a stored suffix would just double up.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const id = (process.argv[2] || "").trim().toLowerCase();
const password = process.argv[3] || "";
const displayName = (process.argv[4] || "").trim();

if (!id || !password || !displayName) {
  console.error(
    "\n  Usage: npm run create-teacher-login -- <id> <password> \"<Name>\"\n" +
      "  Example: npm run create-teacher-login -- shubham.sagar \"shubhamsagar@123\" \"Shubham Sagar\"\n"
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("\n  Password must be at least 8 characters (Firebase's own minimum).\n");
  process.exit(1);
}

const email = id.replace(/\s+/g, "") + "@nst-room-board.internal";

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth();
const db = getFirestore();

async function main() {
  console.log("\n  Setting up teacher login \"" + id + "\" in project " + process.env.FIREBASE_PROJECT_ID + "\n");

  let uid;
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password, displayName });
    uid = existing.uid;
    console.log("  Login \"" + id + "\" already existed - password and name updated.");
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    const created = await auth.createUser({ email, password, displayName, emailVerified: true });
    uid = created.uid;
    console.log("  Created new login \"" + id + "\".");
  }

  const now = Date.now();
  // merge:true, and subjects/years deliberately left out of this write
  // entirely (not even as []) so re-running this for someone who
  // already has subjects set from Admin -> People doesn't wipe them.
  await db.collection("users").doc(uid).set(
    {
      uid,
      email,
      name: displayName,
      role: "faculty",
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  console.log(
    "\n  Done. On the login page, use the \"Sign in with your ID\" form with:\n" +
      "    ID       : " + id + "\n" +
      "    Password : (whatever you just typed)\n\n" +
      "  " + displayName + " lands straight on the board - no onboarding form, no college\n" +
      "  email needed. Add subjects any time from Admin -> People -> Edit subjects.\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
