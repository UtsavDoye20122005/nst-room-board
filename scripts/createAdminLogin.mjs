#!/usr/bin/env node
// ============================================================
//  npm run create-admin-login -- <id> <password> ["Display Name"]
//
//  Creates (or updates the password of) the shared admin login that
//  more than one teacher can sign in with - no personal inbox needed,
//  just an ID and a password, from the "Sign in as admin instead"
//  link at the bottom of the login page.
//
//  Example:
//    npm run create-admin-login -- admin "Some-Strong-Password123" "Admin"
//
//  Safe to run again with a different password for the same id - it
//  updates the existing login instead of failing. Running it for a
//  SECOND id (e.g. "admin2") creates an independent extra admin login
//  that also works, if you ever want more than one.
//
//  This sets the Firestore profile directly (role: admin), so whoever
//  signs in lands straight on a working admin view - no onboarding
//  form, since there's no real inbox behind this account for the
//  onboarding screen to make sense of.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const id = (process.argv[2] || "").trim().toLowerCase();
const password = process.argv[3] || "";
const displayName = process.argv[4] || "Admin";

if (!id || !password) {
  console.error(
    "\n  Usage: npm run create-admin-login -- <id> <password> [\"Display Name\"]\n" +
      "  Example: npm run create-admin-login -- admin \"Some-Strong-Password123\" \"Admin\"\n"
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
  console.log("\n  Setting up admin login \"" + id + "\" in project " + process.env.FIREBASE_PROJECT_ID + "\n");

  let uid;
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password, displayName });
    uid = existing.uid;
    console.log("  Login \"" + id + "\" already existed - password updated.");
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    const created = await auth.createUser({ email, password, displayName, emailVerified: true });
    uid = created.uid;
    console.log("  Created new login \"" + id + "\".");
  }

  const now = Date.now();
  await db.collection("users").doc(uid).set(
    {
      uid,
      email,
      name: displayName,
      role: "admin",
      subjects: [],
      years: [],
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  console.log(
    "\n  Done. On the login page, click \"Sign in as admin instead\" and use:\n" +
      "    Admin ID : " + id + "\n" +
      "    Password : (whatever you just typed)\n\n" +
      "  Share those two things with whoever needs admin access - all of them\n" +
      "  sign in as the same account, so actions show as \"" + displayName + "\" either way.\n\n" +
      "  One-time setup this needs, if you haven't already:\n" +
      "    1. Firebase console -> Authentication -> Sign-in method -> enable \"Email/Password\".\n" +
      "    2. Firebase console -> Firestore -> Rules -> make sure the latest firestore.rules\n" +
      "       (with the nst-room-board.internal line) is published.\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
