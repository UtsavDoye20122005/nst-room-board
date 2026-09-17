#!/usr/bin/env node
// ============================================================
//  npm run clear-invigilation -- --yes
//
//  Wipes the invigilation side back to a clean slate:
//    - every exam day
//    - every duty (so every count goes back to 0)
//    - the whole invigilation log
//
//  The teacher list itself is KEPT, and each teacher's stale
//  counters are reset, so you can draw again straight away.
//  Bookings, notices, the timetable and logins are not touched.
//
//  It refuses to run without --yes, because this cannot be undone.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const confirmed = process.argv.includes("--yes");

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();

/** Firestore takes 500 writes per batch, so go in comfortable chunks. */
async function wipe(name) {
  const snap = await db.collection(name).get();
  if (snap.empty) return 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return snap.size;
}

async function main() {
  const counts = {};
  for (const name of ["duties", "examDays", "invigLog"]) {
    counts[name] = (await db.collection(name).get()).size;
  }
  const teachers = await db.collection("invigilators").get();

  console.log("\n  Project: " + process.env.FIREBASE_PROJECT_ID);
  console.log("  This will delete:");
  console.log("    " + counts.duties + " duties");
  console.log("    " + counts.examDays + " exam days");
  console.log("    " + counts.invigLog + " log entries");
  console.log("  It will KEEP the " + teachers.size + " teachers on the invigilator list.\n");

  if (!confirmed) {
    console.log("  Nothing has been deleted.");
    console.log("  Run it again with --yes if that is what you want:\n");
    console.log("    npm run clear-invigilation -- --yes\n");
    process.exit(0);
  }

  const duties = await wipe("duties");
  const days = await wipe("examDays");
  const log = await wipe("invigLog");

  // Counts are read from the duties now, but old documents may still
  // carry the numbers from the version that stored them. Zero them so
  // nothing stale can show up anywhere.
  if (!teachers.empty) {
    const batch = db.batch();
    teachers.docs.forEach((d) =>
      batch.update(d.ref, { duties: 0, skips: 0, lastDutyDate: null, updatedAt: Date.now() })
    );
    await batch.commit();
  }

  console.log("  Deleted " + duties + " duties, " + days + " exam days, " + log + " log entries.");
  console.log("  " + teachers.size + " teachers kept, all back to 0 duties.\n");
  console.log("  Reload the Exams tab - it should be empty.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
