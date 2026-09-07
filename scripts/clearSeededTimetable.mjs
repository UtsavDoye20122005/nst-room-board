#!/usr/bin/env node
// ============================================================
//  npm run clear-timetable
//
//  Deletes every booking (and its slotLocks) that came from
//  seedTimetable.mjs - identified by facultyUid starting with
//  "seed-teacher-" or being "seed-exam-cell" (CONTEST), which is
//  never used by a real person signing in and booking themselves.
//
//  Why this exists: seedTimetable.mjs only ever ADDS occurrences -
//  it checks each date's slotLock and skips it if one already
//  exists, it never shrinks or deletes a booking that's since
//  changed shape. So when the timetable's own times change (a
//  lecture's end time moved earlier, say), re-running the seed
//  script alone leaves the OLD, wrong-length booking sitting there
//  untouched - the new, corrected entry just gets skipped as
//  "already taken." Run this first, THEN re-run seed-timetable, so
//  the corrected version has a clean slate to write onto.
//
//  Does NOT touch anything a real teacher booked themselves - only
//  the synthetic seed-* faculty ids this script itself writes.
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

function isSeeded(facultyUid) {
  return typeof facultyUid === "string" && (facultyUid.startsWith("seed-teacher-") || facultyUid === "seed-exam-cell");
}

async function main() {
  console.log("\n  Scanning bookings for seed-timetable data…\n");

  const snap = await db.collection("bookings").get();
  const toDelete = snap.docs.filter((d) => isSeeded(d.data().facultyUid));

  if (toDelete.length === 0) {
    console.log("  Nothing to clear - no seeded bookings found.\n");
    process.exit(0);
  }

  console.log("  Deleting " + toDelete.length + " seeded booking(s) and their slot locks…\n");

  let deleted = 0;
  for (const doc of toDelete) {
    const b = doc.data();
    const batch = db.batch();
    batch.delete(doc.ref);
    for (let s = b.startSlot; s <= b.endSlot; s++) {
      batch.delete(db.collection("slotLocks").doc(b.date + "_" + b.roomId + "_" + s));
    }
    await batch.commit();
    deleted++;
    if (deleted % 50 === 0) console.log("    " + deleted + "/" + toDelete.length + "…");
  }

  console.log("\n  Done: " + deleted + " seeded bookings removed.\n  Now run  npm run seed-timetable  to rebuild it from the corrected data.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
