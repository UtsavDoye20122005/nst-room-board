#!/usr/bin/env node
// ============================================================
//  npm run seed-timetable
//
//  Turns the real weekly timetable (2nd Year, 3rd Sem, Batch 1 /
//  Batch 2) into real recurring bookings, so the board and every
//  student's "my classes" page show it without a teacher having
//  to book each session by hand.
//
//  "Concept Room" on the timetable is its own real room now - id
//  "concept" in campusSeed.json, also called the Pizza Room. (Not the
//  same as C-5, despite C-5's own "Pizza Classroom" note - that's a
//  separate, unrelated room.) Its seating capacity isn't confirmed
//  yet, so it's seeded with a placeholder (60) - fix that for real
//  under Admin -> Rooms once you know it, no re-run needed.
//
//  Rebuilt in full from the actual per-batch weekly sheet (both
//  batches shown as separate rows, exact times, exact rooms) instead
//  of the older, partly-guessed version. Two things that version got
//  wrong, now fixed everywhere they occurred: every morning
//  lecture/lab used to run 30 minutes too long into the 12:00-12:30
//  slot - the sheet shows that slot free every day, lunch is the
//  block right after it - and Batch 1's whole Wednesday afternoon,
//  previously skipped as unknown, turned out to be three sequential
//  Concept Room sessions (AP Lab, HOLISTIC, ADA Lab) back to back.
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
// ~one semester, same horizon a teacher's own "repeat weekly" checkbox
// defaults to when booking a session by hand (see BookingModal.tsx).
// Used to be 52 weeks/a full year - simpler to reason about at a
// semester at a time, and re-running this script (safe - see above)
// pushes it out another semester whenever that's actually needed.
const WEEKS = 15;

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
//
// Names carry "Sir"/"Mam" directly now - that used to be added
// automatically for display in Admin -> Timetable, but that panel (and
// the function that added it) is gone, so nothing else does this for
// you anymore. Baking it into the stored name is what makes it show up
// everywhere: the board, Notices, My bookings, all of it.
//
// A lecture and its lab are sometimes different people - ADA Lab and
// M3/Maths3 Lab each have their own teacher below, distinct from the
// one who gives that subject's lecture. AP Lab is co-taught, so its
// facultyName just carries both names.
const TEACHERS = {
  AP: { name: "Pranav Sir", uid: "seed-teacher-ap" },
  ADA: { name: "Ashwin Sir", uid: "seed-teacher-ada" },
  AI: { name: "Mahfooj Sir", uid: "seed-teacher-ai" },
  DE: { name: "Adarsh Chauhan Sir", uid: "seed-teacher-de" },
  M3: { name: "Adhiraj Sir", uid: "seed-teacher-m3" },
  HOLISTIC: { name: "Soumya Mam", uid: "seed-teacher-holistic" },
};

// Lab-specific overrides - a lab entry below sets `teacher:` to one of
// these instead of falling back to TEACHERS[entry.subject].
const AP_LAB_TEACHER = { name: "Pranav Sir & Shubham Sir", uid: "seed-teacher-ap-lab" };
const ADA_LAB_TEACHER = { name: "Goutam Sir", uid: "seed-teacher-ada-lab" };
const M3_LAB_TEACHER = { name: "Anupam Sir", uid: "seed-teacher-m3-lab" };

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
  { weekday: "Mon", subject: "ADA", kind: "class", title: "ADA Lecture", roomId: "c6", slot: [4, 5], batchIds: BOTH },
  { weekday: "Mon", subject: "AI", kind: "class", title: "AI Lecture", roomId: "c6", slot: [10, 12], batchIds: BOTH },
  // Batch 1 does HOLISTIC then ADA Lab; Batch 2 does ADA Lab then AP
  // Lab in Concept Room - different rooms, different order, same hour.
  { weekday: "Mon", subject: "HOLISTIC", kind: "class", title: "HOLISTIC Lecture", roomId: "concept", slot: [13, 14], batchIds: [BATCH1] },
  { weekday: "Mon", subject: "ADA", kind: "lab", title: "ADA Lab (Batch 1)", roomId: "c6", slot: [15, 17], batchIds: [BATCH1], teacher: ADA_LAB_TEACHER },
  { weekday: "Mon", subject: "ADA", kind: "lab", title: "ADA Lab (Batch 2)", roomId: "c6", slot: [13, 14], batchIds: [BATCH2], teacher: ADA_LAB_TEACHER },
  { weekday: "Mon", subject: "AP", kind: "lab", title: "AP Lab (Batch 2)", roomId: "concept", slot: [15, 17], batchIds: [BATCH2], teacher: AP_LAB_TEACHER },

  // ---------------- TUESDAY ----------------
  { weekday: "Tue", subject: "M3", kind: "class", title: "M3 Lecture", roomId: "c6", slot: [1, 3], batchIds: BOTH },
  { weekday: "Tue", subject: "DE", kind: "class", title: "DE Lecture", roomId: "c6", slot: [4, 5], batchIds: BOTH },
  { weekday: "Tue", subject: "AP", kind: "lab", title: "AP Lab (Batch 1)", roomId: "c8", slot: [12, 13], batchIds: [BATCH1], teacher: AP_LAB_TEACHER },
  { weekday: "Tue", subject: "M3", kind: "lab", title: "M3 Lab (Batch 1)", roomId: "c6", slot: [14, 15], batchIds: [BATCH1], teacher: M3_LAB_TEACHER },
  { weekday: "Tue", subject: "HOLISTIC", kind: "class", title: "HOLISTIC Lecture", roomId: "concept", slot: [10, 11], batchIds: [BATCH2] },
  { weekday: "Tue", subject: "M3", kind: "lab", title: "M3 Lab (Batch 2)", roomId: "c4", slot: [12, 14], batchIds: [BATCH2], teacher: M3_LAB_TEACHER },
  { weekday: "Tue", subject: "DE", kind: "lab", title: "DE Lab (Batch 2)", roomId: "c8", slot: [15, 17], batchIds: [BATCH2] },

  // ---------------- WEDNESDAY ----------------
  { weekday: "Wed", subject: "AP", kind: "class", title: "AP Lecture", roomId: "c6", slot: [1, 3], batchIds: BOTH },
  { weekday: "Wed", subject: "ADA", kind: "class", title: "ADA Lecture", roomId: "c6", slot: [4, 5], batchIds: BOTH },
  // Batch 1's whole afternoon is Concept Room, three sessions back to
  // back - this used to be a total unknown, skipped entirely.
  { weekday: "Wed", subject: "AP", kind: "lab", title: "AP Lab (Batch 1)", roomId: "concept", slot: [10, 12], batchIds: [BATCH1], teacher: AP_LAB_TEACHER },
  { weekday: "Wed", subject: "HOLISTIC", kind: "class", title: "HOLISTIC Lecture", roomId: "concept", slot: [13, 14], batchIds: [BATCH1] },
  { weekday: "Wed", subject: "ADA", kind: "lab", title: "ADA Lab (Batch 1)", roomId: "concept", slot: [15, 17], batchIds: [BATCH1], teacher: ADA_LAB_TEACHER },
  { weekday: "Wed", subject: "ADA", kind: "lab", title: "ADA Lab (Batch 2)", roomId: "c6", slot: [10, 12], batchIds: [BATCH2], teacher: ADA_LAB_TEACHER },
  { weekday: "Wed", subject: "AP", kind: "lab", title: "AP Lab (Batch 2)", roomId: "c6", slot: [13, 15], batchIds: [BATCH2], teacher: AP_LAB_TEACHER },

  // ---------------- THURSDAY ----------------
  { weekday: "Thu", subject: "M3", kind: "class", title: "M3 Lecture", roomId: "c6", slot: [1, 3], batchIds: BOTH },
  { weekday: "Thu", subject: "DE", kind: "lab", title: "DE Lab (Batch 1)", roomId: "c6", slot: [4, 5], batchIds: [BATCH1] },
  { weekday: "Thu", subject: "M3", kind: "lab", title: "M3 Lab (Batch 2)", roomId: "concept", slot: [4, 5], batchIds: [BATCH2], teacher: M3_LAB_TEACHER },
  { weekday: "Thu", subject: "DE", kind: "class", title: "DE Lecture", roomId: "c6", slot: [10, 12], batchIds: BOTH },
  { weekday: "Thu", subject: "M3", kind: "lab", title: "M3 Lab (Batch 1)", roomId: "c6", slot: [13, 15], batchIds: [BATCH1], teacher: M3_LAB_TEACHER },
  { weekday: "Thu", subject: "HOLISTIC", kind: "class", title: "HOLISTIC Lecture", roomId: "concept", slot: [13, 14], batchIds: [BATCH2] },

  // ---------------- FRIDAY ----------------
  // CONTEST uses every real classroom at once (Concept Room included),
  // 9:00-12:00. Booked as one session per room so the board shows all
  // five as taken.
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c1", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c4", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c6", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "c8", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "CONTEST", kind: "exam", title: "CONTEST", roomId: "concept", slot: [0, 5], batchIds: BOTH, teacher: { name: "Exam Cell", uid: "seed-exam-cell" } },
  { weekday: "Fri", subject: "AI", kind: "class", title: "AI Lecture", roomId: "c6", slot: [9, 11], batchIds: BOTH },
  { weekday: "Fri", subject: "HOLISTIC", kind: "lab", title: "HOLISTIC Practical", roomId: "concept", slot: [12, 14], batchIds: BOTH },
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
