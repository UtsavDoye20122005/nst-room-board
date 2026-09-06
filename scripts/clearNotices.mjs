#!/usr/bin/env node
// ============================================================
//  npm run clear-notices
//
//  Wipes every document out of the `notices` collection - the
//  "Notices" page everyone (faculty, students, admins) sees. Use this
//  once, right before real people start using the board, to clear out
//  test bookings and any notices left over from earlier testing/admin
//  mistakes (e.g. a cancel-then-redo that left a "CANCELLED (series)"
//  entry behind).
//
//  Does NOT touch bookings, rooms, batches, users or anything else -
//  only the notices feed itself. Nobody's booking is affected; this
//  just clears the log of past announcements.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
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

const db = getFirestore();

/** Firestore batches cap out at 500 writes, so a big collection needs
 *  more than one commit. */
async function deleteAll(collectionName) {
  let total = 0;
  while (true) {
    const snap = await db.collection(collectionName).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    total += snap.size;
    console.log("    deleted " + total + " so far...");
  }
  return total;
}

async function main() {
  console.log("\n  Clearing notices/ in project " + process.env.FIREBASE_PROJECT_ID + "\n");
  const total = await deleteAll("notices");
  console.log(
    total === 0
      ? "\n  Already empty - nothing to clear.\n"
      : "\n  Done. Removed " + total + " notice(s). The Notices page starts fresh from here.\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
