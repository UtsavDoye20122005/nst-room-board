#!/usr/bin/env node
// ============================================================
//  npm run seed-invigilators        add 30 practice teachers
//  npm run seed-invigilators clear  remove them again
//
//  Only for trying the system out. Every teacher it writes has an
//  email ending in @practice.invalid, and `clear` deletes exactly
//  those and nothing else, so your real teachers are never touched.
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
const SUFFIX = "@practice.invalid";

const NAMES = [
  "Ananya Rao",
  "Vikram Nair",
  "Sneha Kulkarni",
  "Arjun Menon",
  "Fatima Sheikh",
  "Rahul Verma",
  "Divya Pillai",
  "Imran Qureshi",
  "Neha Bansal",
  "Karthik Reddy",
  "Meera Iyer",
  "Sanjay Desai",
  "Pooja Chandra",
  "Aditya Ghosh",
  "Ritu Malhotra",
  "Nikhil Joshi",
  "Swati Deshmukh",
  "Harsh Agarwal",
  "Lakshmi Krishnan",
  "Zoya Ahmed",
  "Rohan Bhatt",
  "Preeti Saxena",
  "Manish Chauhan",
  "Aisha Khan",
  "Gaurav Sinha",
  "Tanvi Shetty",
  "Devendra Patil",
  "Kavya Subramanian",
  "Salim Ansari",
  "Ishita Mukherjee",
];

const clearing = process.argv[2] === "clear";

async function main() {
  const snap = await db.collection("invigilators").get();
  const practice = snap.docs.filter((d) => d.id.endsWith(SUFFIX));

  if (clearing) {
    if (!practice.length) {
      console.log("\n  No practice teachers to remove.\n");
      return;
    }
    const batch = db.batch();
    practice.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log("\n  Removed " + practice.length + " practice teachers.\n");
    return;
  }

  const now = Date.now();
  const already = new Set(snap.docs.map((d) => d.id));
  const batch = db.batch();
  let added = 0;
  for (const name of NAMES) {
    const email = name.toLowerCase().replace(/[^a-z]+/g, ".") + SUFFIX;
    // Run it twice and nobody's duty count is wiped: only new names are written.
    if (already.has(email)) continue;
    added++;
    batch.set(db.collection("invigilators").doc(email), {
      email,
      name,
      active: true,
      duties: 0,
      skips: 0,
      lastDutyDate: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!added) {
    console.log("\n  All " + NAMES.length + " practice teachers are already there.\n");
    return;
  }
  await batch.commit();
  console.log("\n  Added " + added + " practice teachers (" + NAMES.length + " in total).");
  console.log("  Open Exams -> Teachers to see them.");
  console.log("  Remove them later with:  npm run seed-invigilators clear\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
