#!/usr/bin/env node
// ============================================================
//  npm run clear-teachers
//
//  Wipes every account with role "faculty" - both the Firestore
//  profile AND the Firebase Auth login behind it. Use this to start
//  clean now that teachers sign in themselves with Google/email
//  instead of being pre-provisioned by createTeacherLogin.mjs - any
//  ID+password teacher logins created that way (and any account
//  someone self-onboarded while testing) get removed either way.
//
//  Does NOT touch admin accounts - role "admin" is left completely
//  alone, so your own admin login and the other admin-teachers' logins
//  keep working. Does NOT touch rooms, batches, bookings or notices -
//  only the users collection, and only the faculty rows in it.
//
//  After this, every teacher's next step is simple: open the site,
//  "Sign in with Google" (or verify email) with their Gmail or
//  newtonschool.co address, and fill in their name/subjects/years on
//  the onboarding screen that appears automatically the first time.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

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
  console.log("\n  Clearing faculty accounts in project " + process.env.FIREBASE_PROJECT_ID + "\n");

  const snap = await db.collection("users").where("role", "==", "faculty").get();
  if (snap.empty) {
    console.log("  Already clean - no faculty accounts found.\n");
    process.exit(0);
  }

  let removed = 0;
  let authFailed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const label = (data.name || data.email || doc.id);

    try {
      await auth.deleteUser(doc.id);
    } catch (e) {
      if (e.code !== "auth/user-not-found") {
        console.log("    could not delete Auth login for " + label + ": " + e.message);
        authFailed++;
      }
    }

    await doc.ref.delete();
    removed++;
    console.log("    removed " + label);
  }

  console.log(
    "\n  Done. Removed " + removed + " faculty account(s)" +
    (authFailed ? " (" + authFailed + " had no matching Auth login to remove, which is fine)" : "") +
    ".\n  Admin accounts were left untouched.\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
