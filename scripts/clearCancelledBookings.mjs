#!/usr/bin/env node
// ============================================================
//  npm run clear-cancelled
//
//  Deletes every booking with status "cancelled" - the grey
//  "CANCELLED" alerts that show up on the Day board. A cancelled
//  RECURRING series leaves one of these behind for every future
//  occurrence it would have had (e.g. 15 future Mondays), so editing
//  a timetable row during setup/testing can leave months of stale
//  "cancelled" clutter behind even though nobody needs to know about
//  a class that was cancelled before it ever really existed.
//
//  Safe to run any time: it only removes bookings already marked
//  cancelled (their room-hour was already freed the moment they were
//  cancelled - see cancelBooking()/cancelSeriesFromDate() in
//  src/lib/db.ts, which delete the matching slotLocks then). It does
//  NOT touch any live/confirmed booking, and does not touch notices,
//  rooms, batches or users.
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

/** Firestore batches cap out at 500 writes, so this may take a few passes. */
async function deleteAllCancelled() {
  let total = 0;
  while (true) {
    const snap = await db.collection("bookings").where("status", "==", "cancelled").limit(400).get();
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
  console.log("\n  Clearing cancelled bookings in project " + process.env.FIREBASE_PROJECT_ID + "\n");
  const total = await deleteAllCancelled();
  console.log(
    total === 0
      ? "\n  Already clean - no cancelled bookings found.\n"
      : "\n  Done. Removed " + total + " cancelled booking(s). The Day board won't show them anymore.\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
