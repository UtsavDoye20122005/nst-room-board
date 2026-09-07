#!/usr/bin/env node
// ============================================================
//  npm run set-password -- someone@gmail.com "SomePassword123"
//
//  Adds (or updates) a PASSWORD sign-in method on an EXISTING
//  Firebase Auth account - the one that already exists because that
//  person signed in with Google at some point. It does NOT create a
//  new account and does NOT touch their Firestore profile, role, or
//  uid - it's the exact same account, same admin/faculty status,
//  just reachable a second way.
//
//  After this, on the login page's "Username & password" tab, they
//  can type their real email address (not a made-up id) in the
//  Username field and this password - lands on the exact same
//  profile as "Sign in with Google" does for that address.
//
//  Use this when someone wants BOTH Google sign-in and a password
//  for the same account. If instead you want an admin/teacher login
//  that has no real inbox behind it at all, use create-admin-login
//  or create-teacher-login instead - those make a separate synthetic
//  account, not this one.
//
//  Fails if that email has never signed in before (no Auth account
//  yet to attach a password to) - have them sign in with Google
//  once first.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const email = (process.argv[2] || "").trim().toLowerCase();
const password = process.argv[3] || "";

if (!email || !password) {
  console.error(
    "\n  Usage: npm run set-password -- someone@gmail.com \"SomePassword123\"\n"
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("\n  Password must be at least 8 characters (Firebase's own minimum).\n");
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth();

async function main() {
  console.log("\n  Looking up existing account for " + email + "…\n");

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      console.error(
        "\n  No account exists yet for " + email + ".\n" +
          "  Have them sign in with Google once first (that creates the account),\n" +
          "  then run this again.\n"
      );
      process.exit(1);
    }
    throw e;
  }

  await auth.updateUser(user.uid, { password });

  console.log(
    "  Done. " + email + " can now sign in two ways:\n" +
      "    - Sign in with Google (as before)\n" +
      "    - Username & password tab -> Username: " + email + ", Password: (what you just set)\n\n" +
      "  Both land on the exact same profile (uid " + user.uid + "), same role.\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
