#!/usr/bin/env node
// ============================================================
//  npm run seed
//
//  Loads the campus rooms and batches into Firestore. Safe to run
//  more than once: it overwrites those documents and touches
//  nothing else, so your bookings are never affected.
// ============================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const seed = JSON.parse(readFileSync(resolve(process.cwd(), "src/data/campusSeed.json"), "utf8"));

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();

/**
 * Deletes any doc in `collection` whose id is no longer in `keepIds` -
 * e.g. a batch you renamed or removed from campusSeed.json. Without
 * this, `set()` above only ever adds/updates and old ids (like a
 * stray "2nd Year - C" from an earlier version of the file) sit in
 * Firestore forever and keep showing up in dropdowns.
 */
async function pruneRemoved(collection, keepIds) {
  const snap = await db.collection(collection).get();
  const stale = snap.docs.filter((d) => !keepIds.has(d.id));
  if (stale.length === 0) return 0;
  const b = db.batch();
  for (const d of stale) {
    b.delete(d.ref);
    console.log("    removed " + collection + "/" + d.id + " (no longer in campusSeed.json)");
  }
  await b.commit();
  return stale.length;
}

async function main() {
  console.log("\n  Seeding project " + process.env.FIREBASE_PROJECT_ID + "\n");

  const roomBatch = db.batch();
  for (const room of seed.rooms) {
    roomBatch.set(db.collection("rooms").doc(room.id), room);
    console.log("    room   " + room.name.padEnd(12) + String(room.capacity).padStart(4) + " seats");
  }
  await roomBatch.commit();
  await pruneRemoved("rooms", new Set(seed.rooms.map((r) => r.id)));

  const batchBatch = db.batch();
  for (const b of seed.batches) {
    batchBatch.set(db.collection("batches").doc(b.id), b);
    console.log("    batch  " + b.name);
  }
  await batchBatch.commit();
  await pruneRemoved("batches", new Set(seed.batches.map((b) => b.id)));

  console.log(
    "\n  Done: " + seed.rooms.length + " rooms, " + seed.batches.length + " batches.\n" +
    "  Next: sign in to the app, then run  npm run make-admin your.email@newtonschool.co\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Seeding failed: " + e.message);
  if (String(e.message).includes("NOT_FOUND")) {
    console.error("  Create the Firestore database first: Firebase console -> Firestore Database -> Create database.\n");
  }
  process.exit(1);
});
