#!/usr/bin/env node
// ============================================================
//  npm run seed-timetable
//
//  Turns the real weekly timetable (2nd Year, 3rd Sem, Batch 1 /
//  Batch 2) into real recurring bookings, so the board and every
//  student's "my classes" page show it without a teacher having
//  to book each session by hand.
//
//  What this skips on purpose:
//   - Everything held in "Concept Room" - that room has no seat
//     count and isn't in the system yet, so it can't be checked
//     for clashes. Add it under Admin -> Rooms once you have its
//     capacity, then re-run this script.
//   - HOLISTIC sessions - Dr. Soumya doesn't have a newtonschool.co
//     address yet, so there's no one to attribute the booking to.
//   - Friday's HOLISTIC PRACTICAL - same reason, and no room was
//     given for it either.
//
//  Safe to run more than once: each session's hour is a deterministic
//  slotLock document, so a re-run just skips weeks that already exist
//  instead of doubling them up.
// ============================================================

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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

// ---- tiny date helpers (mirrors src/lib/dates.ts, in plain JS) ----
function pad(n) { return String(n).padStart(2, "0"); }
function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function fromISO(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function shiftDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function nextWeekday(fromIso, targetDow) {
  let d = fromIso;
  while (fromISO(d).getDay() !== targetDow) d = shiftDays(d, 1);
  return d;
}

const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
const WEEKS = 52; // ~1 year - long enough it rarely needs re-running just to "renew" a series (an edit in Admin -> Timetable pushes it out another year automatically), short enough that a full re-seed stays well inside Firestore's free-plan daily write quota

// Term starts the Monday on/after today, so we never try to book an
// hour that's already in the past today.
const todayIso = toISO(new Date());
const termMonday = nextWeekday(todayIso, 1);

const BATCH1 = "y2-a";
const BATCH2 = "y2-b";
const BOTH = [BATCH1, BATCH2];
const YEAR2 = [2];

// Real teacher -> subject mapping you gave me. No login accounts are
// created for them here - they still self-onboard the normal way the
// first time they sign in. facultyUid is just a label on these seeded
// sessions; as admin you can move or cancel any of them from the board.
const TEACHERS = {
  AP: { name: "Pranav", uid: "seed-teacher-ap" },
  ADA: { name: "Ashwin", uid: "seed-teacher-ada" },
  AI: { name: "Mahfooj", uid: "seed-teacher-ai" },
  DE: { name: "Adarsh Kumar", uid: "seed-teacher-de" },
  M3: { name: "Adhiraj", uid: "seed-teacher-m3" },
};

/**
 * date: ISO date of the FIRST occurrence (any week in the term works -
 *   we snap it to the right weekday below).
 * weekday: "Mon" | "Tue" | "Wed" | "Thu" | "Fri"
 * slot: [startSlot, endSlot] against the new half-hour SLOTS grid in
 *   src/lib/slots.ts (0 = 09:00-09:30 ... 18 = 18:00-18:30).
 */
const ENTRIES = [
  // ---------------- MONDAY ----------------
  { weekday: "Mon", subject: "AP", kind: "class", title: "AP Lecture", roomId: "c6", slot: [1, 3], batchIds: BOTH },
  { weekday: "Mon", subject: "ADA", kind: "class", title: "ADA Lecture", roomId: "c6", slot: [4, 6], batchIds: BOTH },
  { weekday: "Mon", subject: "AI", kind: "class", title: "AI Lecture", roomId: "c6", slot: [10, 12], batchIds: BOTH },
  { weekday: "Mon", subject: "ADA", kind: "lab", title: "ADA Lab (Batch 1)", roomId: "c6", slot: [16, 17], batchIds: [BATCH1] },
  { weekday: "Mon", subject: "ADA", kind: "lab", title: "ADA Lab (Batch 2)", roomId: "c6", slot: [13, 15], batchIds: [BATCH2] },

  // ---------------- TUESDAY ----------------
  { weekday: "Tue", subject: "M3", kind: "class", title: "M3 Lecture", roomId: "c6", slot: [1, 3], batchIds: BOTH },
  { weekday: "Tue", subject: "DE", kind: "class", title: "DE Lecture", roomId: "c6", slot: [4, 6], batchIds: BOTH },
  { weekday: "Tue", subject: "AP", kind: "lab", title: "AP Lab (Batch 1)", roomId: "c8", slot: [12, 13], batchIds: [BATCH1] },
  { weekday: "Tue", subject: "M3", kind: "lab", title: "M3 Lab (Batch 1)", roomId: "c6", slot: [14, 15], batchIds: [BATCH1] },
  { weekday: "Tue", subject: "M3", kind: "lab", title: "M3 Lab (Batch 2)", roomId: "c4", slot: [12, 14], batchIds: [BATCH2] },
  { weekday: "Tue", subject: "DE", kind: "lab", title: "DE Lab (Batch 2)", roomId: "c8", slot: [15, 17], batchIds: [BATCH2] },

  // ---------------- WEDNESDAY ----------------
  { weekday: "Wed", subject: "AP", kind: "class", title: "AP Lecture", roomId: "c6", slot: [1, 3], batchIds: BOTH },
  { weekday: "Wed", subject: "ADA", kind: "class", title: "ADA Lecture", roomId: "c6", slot: [4, 6], batchIds: BOTH },
  // Batch 1's whole Wednesday afternoon is Concept Room - nothing bookable yet.
  { weekday: "Wed", subject: "ADA", kind: "lab", title: "ADA Lab (Batch 2)", roomId: "c6", slot: [10, 12], batchIds: [BATCH2] },
  { weekday: "Wed", subject: "AP", kind: "lab", title: "AP Lab (Batch 2)", roomId: "c6", slot: [13, 15], batchIds: [BATCH2] },

  // ---------------- THURSDAY ----------------
  { weekday: "Thu", subject: "M3", kind: "class", title: "M3 Lecture", roomId: "c6", slot: [1, 3], batchIds: BOTH },
  { weekday: "Thu", subject: "DE", kind: "lab", title: "DE Lab (Batch 1)", roomId: "c6", slot: [4, 6], batchIds: [BATCH1] },
  // Batch 2's 11:00-12:30 Thursday is M3 Lab in Concept Room - skipped.
  { weekday: "Thu", subject: "DE", kind: "class", title: "DE Lecture", roomId: "c6", slot: [10, 12], batchIds: BOTH },
  { weekday: "Thu", subject: "M3", kind: "lab", title: "M3 Lab (Batch 1)", roomId: "c6", slot: [13, 15], batchIds: [BATCH1] },
  // Batch 2's 15:30-16:30 Thursday is HOLISTIC LEC in Concept Room - skipped.

  // ---------------- FRIDAY ----------------
  // CONTEST uses every real classroom at once, 9:00-12:00. Booked as one
  // session per room so the board shows all four as taken.
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c1", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c4", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c6", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c8", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "AI", kind: "class", title: "AI Lecture", roomId: "c6", slot: [9, 11], batchIds: BOTH },
  // Friday's HOLISTIC PRACTICAL (15:00-16:30) has no room listed - skipped.
];

function lockId(date, roomId, slot) { return date + "_" + roomId + "_" + slot; }

async function writeOccurrence(entry, date, seriesId, seriesUntil) {
  const teacher = entry.teacher || TEACHERS[entry.subject];
  const room = ROOM_NAMES[entry.roomId];
  const [startSlot, endSlot] = entry.slot;

  return db.runTransaction(async (tx) => {
    const lockRefs = [];
    for (let s = startSlot; s <= endSlot; s++) {
      lockRefs.push({ slot: s, ref: db.collection("slotLocks").doc(lockId(date, entry.roomId, s)) });
    }
    const snaps = await Promise.all(lockRefs.map((l) => tx.get(l.ref)));
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].exists) {
        const held = snaps[i].data();
        return { ok: false, reason: room + " already held by " + held.facultyName + " (" + held.subject + ")" };
      }
    }

    const now = Date.now();
    const bookingRef = db.collection("bookings").doc();
    tx.set(bookingRef, {
      date,
      roomId: entry.roomId,
      startSlot,
      endSlot,
      kind: entry.kind,
      subject: entry.subject,
      title: entry.title,
      facultyUid: teacher.uid,
      facultyName: teacher.name,
      years: YEAR2,
      batchIds: entry.batchIds,
      note: "Seeded from the official 2nd Year, 3rd Sem timetable.",
      status: "confirmed",
      movedFrom: null,
      seriesId,
      seriesUntil,
      createdAt: now,
      updatedAt: now,
    });
    for (const l of lockRefs) {
      tx.set(l.ref, {
        bookingId: bookingRef.id,
        date,
        roomId: entry.roomId,
        slot: l.slot,
        facultyUid: teacher.uid,
        facultyName: teacher.name,
        title: entry.title,
        subject: entry.subject,
      });
    }
    return { ok: true, id: bookingRef.id };
  });
}

let ROOM_NAMES = {};

async function main() {
  console.log("\n  Seeding the real timetable into project " + process.env.FIREBASE_PROJECT_ID);
  console.log("  Term start (next Monday): " + termMonday + "  ·  " + WEEKS + " weeks\n");

  const roomSnap = await db.collection("rooms").get();
  if (roomSnap.empty) {
    console.error("  No rooms found - run  npm run seed  first.\n");
    process.exit(1);
  }
  roomSnap.forEach((d) => { ROOM_NAMES[d.id] = d.data().name; });

  let totalBooked = 0;
  let totalSkipped = 0;

  for (const entry of ENTRIES) {
    const dow = DOW[entry.weekday];
    const firstDate = nextWeekday(termMonday, dow);
    const dates = [];
    for (let d = firstDate; dates.length < WEEKS; d = shiftDays(d, 7)) dates.push(d);
    const untilDate = dates[dates.length - 1];

    const seriesId = "seed-" + entry.weekday.toLowerCase() + "-" + entry.roomId + "-" + entry.subject.toLowerCase() + "-" + entry.slot[0];

    let booked = 0;
    let skipped = 0;
    let firstReason = "";
    for (const date of dates) {
      const res = await writeOccurrence(entry, date, seriesId, untilDate);
      if (res.ok) booked++;
      else {
        skipped++;
        firstReason = firstReason || res.reason;
      }
    }

    totalBooked += booked;
    totalSkipped += skipped;

    console.log(
      "    " + entry.weekday.padEnd(4) + entry.title.padEnd(24) + (ROOM_NAMES[entry.roomId] || entry.roomId).padEnd(12) +
      booked + "/" + dates.length + " weeks" + (skipped ? "  (" + skipped + " skipped - " + firstReason + ")" : "")
    );
  }

  console.log(
    "\n  Done: " + totalBooked + " sessions booked" +
    (totalSkipped ? ", " + totalSkipped + " skipped (already taken)" : "") + ".\n" +
    "  Skipped on purpose: everything in Concept Room, and HOLISTIC sessions\n" +
    "  (Dr. Soumya has no newtonschool.co address yet).\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  Failed: " + e.message + "\n");
  process.exit(1);
});
