#!/usr/bin/env node
// ============================================================
//  npm run seed-roster
//
//  Builds the `roster` collection (email -> year/batch, so onboarding
//  can recognise a student before they ever sign in) from the same
//  extraEmails already sitting on each batch in campusSeed.json.
//  Nothing new to type in - this just reshapes data you already gave.
//
//  Names come from src/data/roster2ndYear.json (and any other
//  src/data/roster<Year>.json files dropped in later, e.g. 1st year)
//  matched by email. Anyone in campusSeed.json's extraEmails who isn't
//  found in one of those name files just gets name: "" - they still
//  type their own name once, but their Year and Batch are locked in.
//  Re-run this script any time campusSeed.json or a roster name file
//  changes - it's a full overwrite of the roster collection, keyed by
//  email.
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, requireAdminEnv } from "./env.mjs";

loadEnv();
requireAdminEnv();

const seed = JSON.parse(readFileSync(resolve(process.cwd(), "src/data/campusSeed.json"), "utf8"));

// Load every known name file and build one email -> name lookup.
// Add more filenames here as more year/roster data comes in.
const nameFiles = ["src/data/roster2ndYear.json", "src/data/roster1stYear.json"];
const nameByEmail = new Map();
for (const f of nameFiles) {
  const p = resolve(process.cwd(), f);
  if (!existsSync(p)) continue;
  const rows = JSON.parse(readFileSync(p, "utf8"));
  for (const r of rows) {
    if (r.email && r.name) nameByEmail.set(r.email.trim().toLowerCase(), r.name.trim());
  }
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();

async function main() {
  console.log("\n  Building the roster for " + process.env.FIREBASE_PROJECT_ID + "\n");

  let batch = db.batch();
  let count = 0;
  let inBatch = 0;

  for (const b of seed.batches) {
    for (const email of b.extraEmails || []) {
      const e = email.trim().toLowerCase();
      if (!e.includes("@")) continue;
      batch.set(db.collection("roster").doc(e), {
        email: e,
        name: nameByEmail.get(e) || "",
        year: b.year,
        batchId: b.id,
      });
      count++;
      inBatch++;
      if (inBatch >= 450) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
  }
  if (inBatch > 0) await batch.commit();

  const withNames = [...nameByEmail.keys()].filter((e) => seed.batches.some((b) => (b.extraEmails || []).map((x) => x.trim().toLowerCase()).includes(e))).length;
  console.log(
    "  Done: " + count + " student(s) loaded into the roster (" + withNames + " with a name pre-filled).\n" +
    "  Anyone without a name on file still types it once, but their Year\n" +
    "  and Batch are locked in for them either way.\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
