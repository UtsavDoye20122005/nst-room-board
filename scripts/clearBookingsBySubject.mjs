#!/usr/bin/env node
// ============================================================
//  npm run clear-test-bookings -- [subject1] [subject2] ...
//
//  Deletes every booking whose subject exactly matches one of the
//  given strings (case-insensitive) - AND the slotLocks that hold
//  its room/slot reserved, so the room actually frees up on the
//  board instead of just disappearing from view. Built for wiping
//  out garbled test bookings before real people use the board.
//
//  With no arguments, defaults to the known test-junk subjects left
//  over from this project's own setup testing: kmklnjhgfd, robo,
//  crft, wdwdq.
//
//  Exact match only, so this is safe to run without arguments even
//  later on - a real subject code (PSP, AP, ADA, HOLISTIC, YOGA, ...)
//  never collides with these test strings.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const DEFAULT_JUNK = ["kmklnjhgfd", "robo", "crft", "wdwdq"];
const args = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
const targets = new Set((args.length ? args : DEFAULT_JUNK).map((s) => s.toLowerCase()));

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();

function lockId(date, roomId, slot) {
  return date + "_" + roomId + "_" + slot;
}

async function main() {
  console.log("\n  Looking for bookings with subject in: " + Array.from(targets).join(", ") + "\n");

  const snap = await db.collection("bookings").get();
  const matches = snap.docs.filter((d) => targets.has(String(d.data().subject || "").trim().toLowerCase()));

  if (matches.length === 0) {
    console.log("  Nothing matched - already clean.\n");
    process.exit(0);
  }

  let deleted = 0;
  for (const d of matches) {
    const b = d.data();
    console.log(
      "  Deleting: " + b.subject + " (" + (b.title || "no title") + ") · " + b.date + " · " +
        b.roomId + " · slots " + b.startSlot + "-" + b.endSlot + " · status: " + b.status
    );
    const batch = db.batch();
    batch.delete(d.ref);
    for (let s = b.startSlot; s <= b.endSlot; s++) {
      batch.delete(db.collection("slotLocks").doc(lockId(b.date, b.roomId, s)));
    }
    await batch.commit();
    deleted++;
  }

  console.log("\n  Done. Removed " + deleted + " booking(s) and their room locks. The board is clean.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
