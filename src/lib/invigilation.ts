"use client";

// ============================================================
//  Invigilation duties.
//
//  WHAT THIS FILE OWNS
//   - the invigilator list (teachers who can be given duty)
//   - exam days (a date, a time, the rooms used, how many
//     invigilators each room needs)
//   - duties (one document per teacher per exam day)
//   - the fair-random assignment itself
//
//  WHY DUTIES ARE A TOP-LEVEL COLLECTION, NOT A SUBCOLLECTION
//  A teacher must be able to read "my duties" and an admin "every
//  duty on Friday". Both are single-field equality queries here
//  (email == me, date == friday), so neither needs a composite
//  index, and the security rules can let a teacher read exactly
//  their own rows and nothing else.
//
//  FAIRNESS, IN ONE LINE
//  Pure random gives one teacher six duties and another one. So a
//  teacher's chance of being picked is (busiest teacher's count +
//  1 - their own count). Fewer duties means a bigger ticket in the
//  draw. It still feels random, but it evens out over a term.
// ============================================================

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { SLOTS } from "./slots";
import type {
  Booking,
  Duty,
  ExamDay,
  ExamRoomPlan,
  Invigilator,
  Room,
  UserProfile,
} from "./types";

/** Seats one invigilator can reasonably watch. Used for the suggested count. */
export const SEATS_PER_INVIGILATOR = 40;

/** A big room needs more people. Admin can always override the number. */
export function suggestNeeded(capacity: number): number {
  return Math.max(1, Math.ceil((capacity || 0) / SEATS_PER_INVIGILATOR));
}

/** How long before the exam a teacher may still skip without asking. */
export const SKIP_FREE_HOURS = 24;

/**
 * How long a teacher has to say "I'm here". It opens when the exam
 * starts, not before - somebody marking themselves present the night
 * before is not attendance, it is a tick box. After it closes the exam
 * office does it, because by then only they know who actually came.
 */
export const ATTENDANCE_WINDOW_MINUTES = 30;

/** The moment an exam starts, in milliseconds, from its date and slot. */
export function examStartMs(date: string, startSlot: number): number {
  const slot = SLOTS.find((s) => s.index === startSlot) || SLOTS[0];
  return new Date(date + "T" + slot.start + ":00").getTime();
}

export interface AttendanceWindow {
  opensAt: number;
  closesAt: number;
  /** Too early to mark yourself. */
  early: boolean;
  /** Open now. */
  open: boolean;
  /** Over - the exam office marks it from here on. */
  closed: boolean;
}

export function attendanceWindow(duty: Duty, now = Date.now()): AttendanceWindow {
  const opensAt = duty.startsAt || examStartMs(duty.date, duty.startSlot);
  const closesAt = opensAt + ATTENDANCE_WINDOW_MINUTES * 60 * 1000;
  return {
    opensAt,
    closesAt,
    early: now < opensAt,
    open: now >= opensAt && now <= closesAt,
    closed: now > closesAt,
  };
}

export const dutyId = (date: string, email: string) => date + "__" + email.toLowerCase();
export const cleanEmail = (email: string) => (email || "").trim().toLowerCase();

// ------------------------------------------------------------
//  Invigilator list
// ------------------------------------------------------------

export function subscribeInvigilators(
  cb: (list: Invigilator[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), "invigilators"),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Invigilator), email: d.id }));
      // Sorted here, not in the query, so Firestore needs no index.
      list.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

export async function upsertInvigilator(input: {
  email: string;
  name: string;
  active?: boolean;
}): Promise<void> {
  const email = cleanEmail(input.email);
  if (!email) throw new Error("An email is needed.");
  const ref = doc(getDb(), "invigilators", email);
  const existing = await getDoc(ref);
  const now = Date.now();
  if (existing.exists()) {
    await updateDoc(ref, {
      name: input.name.trim(),
      active: input.active ?? (existing.data() as Invigilator).active,
      updatedAt: now,
    });
    return;
  }
  const fresh: Invigilator = {
    email,
    name: input.name.trim() || email,
    active: input.active ?? true,
    duties: 0,
    skips: 0,
    lastDutyDate: null,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, fresh);
}

export async function setInvigilatorActive(email: string, active: boolean): Promise<void> {
  await updateDoc(doc(getDb(), "invigilators", cleanEmail(email)), { active, updatedAt: Date.now() });
}

export async function deleteInvigilator(email: string): Promise<void> {
  await deleteDoc(doc(getDb(), "invigilators", cleanEmail(email)));
}

/** One click in Admin: everyone with a faculty login becomes an invigilator. */
export async function importFaculty(users: UserProfile[]): Promise<number> {
  const staff = users.filter((u) => u.role === "faculty" || u.role === "admin");
  const batch = writeBatch(getDb());
  const now = Date.now();
  let added = 0;
  for (const u of staff) {
    const email = cleanEmail(u.email);
    if (!email) continue;
    const ref = doc(getDb(), "invigilators", email);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    batch.set(ref, {
      email,
      name: u.name || email,
      active: true,
      duties: 0,
      skips: 0,
      lastDutyDate: null,
      createdAt: now,
      updatedAt: now,
    } as Invigilator);
    added++;
  }
  if (added) await batch.commit();
  return added;
}

// ------------------------------------------------------------
//  Exam days
// ------------------------------------------------------------

export function subscribeExamDays(
  cb: (days: ExamDay[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), "examDays"),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as ExamDay), id: d.id }));
      list.sort((a, b) => b.date.localeCompare(a.date)); // newest first
      cb(list);
    },
    (e) => onError?.(e)
  );
}

export async function saveExamDay(day: ExamDay): Promise<void> {
  await setDoc(doc(getDb(), "examDays", day.id), { ...day, updatedAt: Date.now() }, { merge: true });
}

/** Deletes the exam day and every duty that belongs to it. */
export async function deleteExamDay(day: ExamDay): Promise<void> {
  const duties = await getDocs(query(collection(getDb(), "duties"), where("date", "==", day.date)));
  const batch = writeBatch(getDb());
  duties.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(getDb(), "examDays", day.id));
  await batch.commit();
}

/** Rooms with a suggested invigilator count, ready for a new exam day. */
export function roomPlansFrom(rooms: Room[]): ExamRoomPlan[] {
  return rooms
    .filter((r) => r.active !== false)
    .map((r) => ({
      roomId: r.id,
      roomName: r.name,
      capacity: r.capacity || 0,
      needed: suggestNeeded(r.capacity || 0),
      used: true,
    }));
}

// ------------------------------------------------------------
//  Duties
// ------------------------------------------------------------

export function subscribeDutiesOn(
  date: string,
  cb: (duties: Duty[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "duties"), where("date", "==", date)),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Duty), id: d.id }));
      list.sort((a, b) => a.roomName.localeCompare(b.roomName) || a.name.localeCompare(b.name));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

/** Every duty ever given to one teacher - their own history, and the log. */
export function subscribeDutiesFor(
  email: string,
  cb: (duties: Duty[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "duties"), where("email", "==", cleanEmail(email))),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Duty), id: d.id }));
      list.sort((a, b) => b.date.localeCompare(a.date));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

/** Partner requests waiting for me to say yes or no. */
export function subscribePartnerRequests(
  email: string,
  cb: (duties: Duty[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "duties"), where("partnerRequestTo", "==", cleanEmail(email))),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Duty), id: d.id }));
      list.sort((a, b) => a.date.localeCompare(b.date));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

/**
 * Every duty ever recorded. Small by nature - a few hundred a year -
 * and it is what the teacher list and the log are counted from, so a
 * count can never drift away from what actually happened.
 */
export function subscribeAllDuties(
  cb: (duties: Duty[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), "duties"),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Duty), id: d.id }));
      list.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

export interface Tally {
  duties: number;
  skips: number;
  last: string | null;
}

/** Counts each teacher's duties, straight from the duty documents. */
export function tallyDuties(duties: Duty[]): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const d of duties) {
    const key = cleanEmail(d.email);
    const cur = out.get(key) || { duties: 0, skips: 0, last: null };
    if (d.status === "skipped") cur.skips++;
    else {
      cur.duties++;
      if (!cur.last || d.date > cur.last) cur.last = d.date;
    }
    out.set(key, cur);
  }
  return out;
}

export const EMPTY_TALLY: Tally = { duties: 0, skips: 0, last: null };

export async function getDutiesOn(date: string): Promise<Duty[]> {
  const snap = await getDocs(query(collection(getDb(), "duties"), where("date", "==", date)));
  return snap.docs.map((d) => ({ ...(d.data() as Duty), id: d.id }));
}

// ------------------------------------------------------------
//  The draw
// ------------------------------------------------------------

/** Small seedable random, so a run can be repeated exactly in a test. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PoolMember {
  email: string;
  name: string;
  duties: number;
}

export interface AssignmentPlan {
  picks: { email: string; name: string; roomId: string; roomName: string }[];
  reserves: PoolMember[];
  /** How many seats could not be filled because the pool ran out. */
  short: number;
}

/**
 * Picks one teacher, with fewer past duties meaning a better chance.
 * Weight = (busiest count + 1) - own count, so the busiest teacher
 * still has a ticket (weight 1) and the freshest has the most.
 */
function weightedTake(pool: PoolMember[], rng: () => number): PoolMember | null {
  if (!pool.length) return null;
  const max = pool.reduce((m, p) => Math.max(m, p.duties), 0);
  const weights = pool.map((p) => max + 1 - p.duties);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool.splice(i, 1)[0];
  }
  return pool.splice(pool.length - 1, 1)[0];
}

/**
 * The whole draw, with no Firestore in sight so it can be tested.
 * `pool` should already have busy teachers removed.
 */
export function planAssignments(opts: {
  rooms: ExamRoomPlan[];
  pool: PoolMember[];
  reserveCount: number;
  rng: () => number;
}): AssignmentPlan {
  const left = opts.pool.map((p) => ({ ...p }));
  const picks: AssignmentPlan["picks"] = [];
  let short = 0;

  // Room order is shuffled so the same room isn't always served first
  // when the pool is too small to fill everything.
  const rooms = opts.rooms.filter((r) => r.used !== false && r.needed > 0).map((r) => ({ ...r }));
  for (let i = rooms.length - 1; i > 0; i--) {
    const j = Math.floor(opts.rng() * (i + 1));
    [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
  }

  for (const room of rooms) {
    for (let n = 0; n < room.needed; n++) {
      const person = weightedTake(left, opts.rng);
      if (!person) { short++; continue; }
      picks.push({ email: person.email, name: person.name, roomId: room.roomId, roomName: room.roomName });
    }
  }

  const reserves: PoolMember[] = [];
  for (let n = 0; n < opts.reserveCount; n++) {
    const person = weightedTake(left, opts.rng);
    if (person) reserves.push(person);
  }

  picks.sort((a, b) => a.roomName.localeCompare(b.roomName) || a.name.localeCompare(b.name));
  return { picks, reserves, short };
}

/**
 * Teachers who already have a class or lab in those hours. Room Board
 * knows this, so nobody is ever given an invigilation that clashes
 * with their own session.
 */
export function busyEmailsOn(
  day: { date: string; startSlot: number; endSlot: number },
  bookings: Booking[],
  users: UserProfile[]
): Set<string> {
  const byUid = new Map(users.map((u) => [u.uid, cleanEmail(u.email)]));
  const busy = new Set<string>();
  for (const b of bookings) {
    if (b.date !== day.date || b.status === "cancelled") continue;
    const overlaps = b.startSlot <= day.endSlot && b.endSlot >= day.startSlot;
    if (!overlaps) continue;
    const email = byUid.get(b.facultyUid);
    if (email) busy.add(email);
  }
  return busy;
}

/**
 * Writes a fresh set of duties for one exam day: every old duty for
 * that date is cleared first, so pressing Assign twice never leaves
 * ghosts behind. Duty counters on the invigilator move with it.
 */
export async function writeAssignments(
  day: ExamDay,
  plan: AssignmentPlan,
  by: { email: string; name: string }
): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);
  const now = Date.now();

  // Read EVERY duty first, not just this day's. Two reasons: the old
  // round for this date is about to be deleted, and who was paired
  // with whom has to survive that deletion - otherwise redrawing the
  // same day would forget the pairs it is meant to ask about.
  const everything = await getAllDuties();
  const old = everything.filter((d) => d.date === day.date);
  const pairedBefore = lastPartnersFrom(everything);

  // Clear the old round. Counts look after themselves: they are read
  // from these documents, so deleting one un-counts it.
  for (const d of old) batch.delete(doc(db, "duties", d.id));

  for (const p of plan.picks) {
    const id = dutyId(day.date, p.email);
    const duty: Duty = {
      id,
      date: day.date,
      email: p.email,
      name: p.name,
      roomId: p.roomId,
      roomName: p.roomName,
      startSlot: day.startSlot,
      endSlot: day.endSlot,
      // Stored, so the attendance window can be checked by the
      // database rules and not only by the screen.
      startsAt: examStartMs(day.date, day.startSlot),
      status: "assigned",
      skipReason: "",
      skipAt: null,
      partnerRequestTo: null,
      partnerRequestAt: null,
      partnerLocked: false,
      partnerName: null,
      // A fresh draw asks the question again, so last time's "no"
      // does not carry over to this exam.
      pairAgain: null,
      // Stamped on at draw time, from the round being replaced or any
      // earlier one. This is what "do you want the same partner
      // again?" is asked from, and it keeps working even after the
      // old exam days have been deleted.
      lastPartnerEmail: pairedBefore.get(p.email)?.email ?? null,
      lastPartnerName: pairedBefore.get(p.email)?.name ?? null,
      lastPartnerDate: pairedBefore.get(p.email)?.date ?? null,
      present: null,
      markedAt: null,
      markedBy: null,
      assignedAt: now,
      updatedAt: now,
    };
    batch.set(doc(db, "duties", id), duty);
  }

  batch.set(
    doc(db, "examDays", day.id),
    { reserves: plan.reserves.map((r) => r.email), updatedAt: now },
    { merge: true }
  );

  await batch.commit();
  await addLog({
    action: "assigned",
    text:
      plan.picks.length +
      " duties given out for " +
      day.date +
      (plan.short ? " (" + plan.short + " seats could not be filled)" : ""),
    date: day.date,
    by,
  });
}

// ------------------------------------------------------------
//  What a teacher can do
// ------------------------------------------------------------

/** True while the teacher may still drop out without asking an admin. */
export function canSkipFreely(duty: Duty, startsAtMs: number): boolean {
  return startsAtMs - Date.now() > SKIP_FREE_HOURS * 3600 * 1000;
}

/**
 * A skip always replaces itself. The freest teacher who has no duty
 * that day and no class in those hours takes the seat, so the room is
 * never left short.
 */
export async function skipDuty(opts: {
  duty: Duty;
  reason: string;
  free: boolean;
  pool: PoolMember[];
  takenEmails: string[];
  by: { email: string; name: string };
}): Promise<{ replacedBy: string | null }> {
  const db = getDb();
  const now = Date.now();

  if (!opts.free) {
    await updateDoc(doc(db, "duties", opts.duty.id), {
      status: "skip-requested",
      skipReason: opts.reason,
      skipAt: now,
      updatedAt: now,
    });
    await addLog({
      action: "skip-requested",
      text: opts.duty.name + " asked to drop " + opts.duty.roomName + " on " + opts.duty.date,
      date: opts.duty.date,
      by: opts.by,
    });
    return { replacedBy: null };
  }

  const replacement = pickReplacement(opts.pool, opts.takenEmails, opts.duty.email);
  const batch = writeBatch(db);
  batch.update(doc(db, "duties", opts.duty.id), {
    status: "skipped",
    skipReason: opts.reason,
    skipAt: now,
    partnerRequestTo: null,
    updatedAt: now,
  });
  if (replacement) {
    const id = dutyId(opts.duty.date, replacement.email);
    batch.set(doc(db, "duties", id), {
      id,
      date: opts.duty.date,
      email: replacement.email,
      name: replacement.name,
      roomId: opts.duty.roomId,
      roomName: opts.duty.roomName,
      startSlot: opts.duty.startSlot,
      endSlot: opts.duty.endSlot,
      startsAt: opts.duty.startsAt || examStartMs(opts.duty.date, opts.duty.startSlot),
      status: "assigned",
      skipReason: "",
      skipAt: null,
      partnerRequestTo: null,
      partnerRequestAt: null,
      partnerLocked: false,
      partnerName: null,
      present: null,
      markedAt: null,
      markedBy: null,
      assignedAt: now,
      updatedAt: now,
    } as Duty);
  }

  await batch.commit();
  await addLog({
    action: "skipped",
    text:
      opts.duty.name +
      " dropped " +
      opts.duty.roomName +
      " on " +
      opts.duty.date +
      (replacement ? ", " + replacement.name + " took it" : ", nobody free to replace them"),
    date: opts.duty.date,
    by: opts.by,
  });
  return { replacedBy: replacement ? replacement.name : null };
}

function pickReplacement(pool: PoolMember[], taken: string[], leaving: string): PoolMember | null {
  const busy = new Set(taken.map(cleanEmail));
  busy.add(cleanEmail(leaving));
  const free = pool.filter((p) => !busy.has(cleanEmail(p.email)));
  if (!free.length) return null;
  free.sort((a, b) => a.duties - b.duties || a.name.localeCompare(b.name));
  // Among the few with the lowest count, pick one at random so it is
  // not always the same name at the top of the alphabet.
  const lowest = free.filter((p) => p.duties === free[0].duties);
  return lowest[Math.floor(Math.random() * lowest.length)];
}

/** Admin decides on a late skip. */
export async function decideSkip(opts: {
  duty: Duty;
  approve: boolean;
  pool: PoolMember[];
  takenEmails: string[];
  by: { email: string; name: string };
}): Promise<void> {
  if (!opts.approve) {
    await updateDoc(doc(getDb(), "duties", opts.duty.id), {
      status: "assigned",
      skipReason: "",
      skipAt: null,
      updatedAt: Date.now(),
    });
    await addLog({
      action: "skip-rejected",
      text: opts.duty.name + " must keep " + opts.duty.roomName + " on " + opts.duty.date,
      date: opts.duty.date,
      by: opts.by,
    });
    return;
  }
  await skipDuty({
    duty: opts.duty,
    reason: opts.duty.skipReason || "",
    free: true,
    pool: opts.pool,
    takenEmails: opts.takenEmails,
    by: opts.by,
  });
}

/**
 * "I would like to be with X." Nothing moves until X agrees, so one
 * popular teacher cannot be dragged around by everyone else.
 */
export async function requestPartner(duty: Duty, targetEmail: string): Promise<void> {
  await updateDoc(doc(getDb(), "duties", duty.id), {
    partnerRequestTo: cleanEmail(targetEmail) || null,
    partnerRequestAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * X says yes. The two rooms are swapped so both end up together:
 * the asker moves into X's room, and somebody from X's room takes
 * the asker's old seat. Room counts stay exactly as the admin set them.
 */
export async function acceptPartner(opts: {
  asker: Duty;
  me: Duty;
  othersInMyRoom: Duty[];
  by: { email: string; name: string };
}): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const swapWith = opts.othersInMyRoom.find(
    (d) => d.email !== opts.me.email && d.status === "assigned" && d.email !== opts.asker.email
  );
  const batch = writeBatch(db);

  // Both sides are fixed once they agree. Neither can change it
  // afterwards - only the exam office can, from the Exams screen.
  batch.update(doc(db, "duties", opts.asker.id), {
    roomId: opts.me.roomId,
    roomName: opts.me.roomName,
    partnerRequestTo: null,
    partnerRequestAt: null,
    partnerLocked: true,
    partnerName: opts.me.name,
    updatedAt: now,
  });
  batch.update(doc(db, "duties", opts.me.id), {
    partnerLocked: true,
    partnerName: opts.asker.name,
    updatedAt: now,
  });
  if (swapWith) {
    batch.update(doc(db, "duties", swapWith.id), {
      roomId: opts.asker.roomId,
      roomName: opts.asker.roomName,
      updatedAt: now,
    });
  }
  await batch.commit();
  await addLog({
    action: "paired",
    text:
      opts.asker.name +
      " and " +
      opts.me.name +
      " are together in " +
      opts.me.roomName +
      " on " +
      opts.me.date +
      (swapWith ? " (" + swapWith.name + " moved to " + opts.asker.roomName + ")" : ""),
    date: opts.me.date,
    by: opts.by,
  });
}

export async function declinePartner(asker: Duty): Promise<void> {
  await updateDoc(doc(getDb(), "duties", asker.id), {
    partnerRequestTo: null,
    partnerRequestAt: null,
    updatedAt: Date.now(),
  });
}

export interface PastPartner {
  email: string;
  name: string;
  date: string;
}

/** Every duty there is, ordered newest first. */
export async function getAllDuties(): Promise<Duty[]> {
  const snap = await getDocs(collection(getDb(), "duties"));
  return snap.docs
    .map((d) => ({ ...(d.data() as Duty), id: d.id }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * For every teacher, the last colleague they were actually FIXED with
 * - a pair both of them agreed to, not merely two people who happened
 * to share a room.
 *
 * Read from the duty documents themselves, so there is no second copy
 * of the truth to go stale. A pair that is still standing on the day
 * being redrawn counts too: that is the common case, the admin
 * redrawing the same exam.
 */
export function lastPartnersFrom(duties: Duty[]): Map<string, PastPartner> {
  const byDate = [...duties].sort((a, b) => b.date.localeCompare(a.date));
  const out = new Map<string, PastPartner>();
  for (const d of byDate) {
    if (d.partnerLocked !== true) continue;
    const me = cleanEmail(d.email);
    if (out.has(me)) continue; // the newest one wins
    const other = byDate.find(
      (x) => x.date === d.date && x.roomId === d.roomId && cleanEmail(x.email) !== me && x.status !== "skipped"
    );
    if (other) out.set(me, { email: cleanEmail(other.email), name: other.name, date: d.date });
  }
  return out;
}

/**
 * A teacher would rather have somebody who is NOT on duty that day -
 * one of the spares. That swaps a colleague out, which is not a
 * teacher's call, so it is written on the duty as a request and the
 * exam office decides.
 */
export async function requestSwapIn(opts: {
  duty: Duty;
  want: { email: string; name: string };
  out: { email: string; name: string };
  by: { email: string; name: string };
}): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(getDb(), "duties", opts.duty.id), {
    pairAgain: "no",
    swapWantEmail: cleanEmail(opts.want.email),
    swapWantName: opts.want.name,
    swapOutEmail: cleanEmail(opts.out.email),
    swapOutName: opts.out.name,
    swapAt: now,
    updatedAt: now,
  });
  await addLog({
    action: "swap-wanted",
    text:
      opts.duty.name +
      " asked for " +
      opts.want.name +
      " instead of " +
      opts.out.name +
      " in " +
      opts.duty.roomName,
    date: opts.duty.date,
    by: opts.by,
  });
}

/** The teacher changing their mind before the office has answered. */
export async function cancelSwapIn(duty: Duty): Promise<void> {
  await updateDoc(doc(getDb(), "duties", duty.id), {
    swapWantEmail: null,
    swapWantName: null,
    swapOutEmail: null,
    swapOutName: null,
    swapAt: null,
    updatedAt: Date.now(),
  });
}

/**
 * The exam office answering a swap request. Approving takes the named
 * colleague off the duty and puts the requested teacher in their
 * place, in one write, so the room is never left short in between.
 */
export async function decideSwapIn(opts: {
  duty: Duty;
  approve: boolean;
  by: { email: string; name: string };
}): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const { duty } = opts;
  const clear = {
    swapWantEmail: null,
    swapWantName: null,
    swapOutEmail: null,
    swapOutName: null,
    swapAt: null,
    updatedAt: now,
  };

  if (!opts.approve || !duty.swapWantEmail || !duty.swapOutEmail) {
    await updateDoc(doc(db, "duties", duty.id), clear);
    await addLog({
      action: "swap-refused",
      text: "The swap " + duty.name + " asked for in " + duty.roomName + " was not made",
      date: duty.date,
      by: opts.by,
    });
    return;
  }

  const inId = dutyId(duty.date, duty.swapWantEmail);
  const outId = dutyId(duty.date, duty.swapOutEmail);
  const batch = writeBatch(db);
  batch.delete(doc(db, "duties", outId));
  batch.set(doc(db, "duties", inId), {
    id: inId,
    date: duty.date,
    email: cleanEmail(duty.swapWantEmail),
    name: duty.swapWantName || duty.swapWantEmail,
    roomId: duty.roomId,
    roomName: duty.roomName,
    startSlot: duty.startSlot,
    endSlot: duty.endSlot,
    startsAt: duty.startsAt || examStartMs(duty.date, duty.startSlot),
    status: "assigned",
    skipReason: "",
    skipAt: null,
    partnerRequestTo: null,
    partnerRequestAt: null,
    partnerLocked: false,
    partnerName: null,
    pairAgain: null,
    lastPartnerEmail: null,
    lastPartnerName: null,
    lastPartnerDate: null,
    present: null,
    markedAt: null,
    markedBy: null,
    assignedAt: now,
    updatedAt: now,
  } as Duty);
  batch.update(doc(db, "duties", duty.id), clear);
  await batch.commit();

  await addLog({
    action: "swapped",
    text:
      (duty.swapWantName || duty.swapWantEmail) +
      " takes " +
      (duty.swapOutName || duty.swapOutEmail) +
      "'s place in " +
      duty.roomName +
      ", as " +
      duty.name +
      " asked",
    date: duty.date,
    by: opts.by,
  });
}

/**
 * "Not this time." The question stops being asked for this exam and
 * the teacher gets the list of everybody still free instead.
 *
 * When there is nobody to swap with - a one-room exam, say - the list
 * would be empty and the teacher would be stuck, so the exam office
 * is told instead. That is the only route left, and it should not
 * depend on the teacher remembering to send an email.
 */
export async function declineRepeat(
  duty: Duty,
  opts?: { alone?: boolean; by?: { email: string; name: string } }
): Promise<void> {
  await updateDoc(doc(getDb(), "duties", duty.id), {
    pairAgain: "no",
    updatedAt: Date.now(),
  });
  if (opts?.alone && opts.by) {
    await addLog({
      action: "partner-wanted",
      text: duty.name + " would rather not be paired as drawn in " + duty.roomName + ", and has nobody to swap with",
      date: duty.date,
      by: opts.by,
    });
  }
}

/**
 * The exam office undoing a pair, so the two teachers can choose
 * again or be moved apart.
 */
export async function unlockPartner(duty: Duty, by: { email: string; name: string }): Promise<void> {
  await updateDoc(doc(getDb(), "duties", duty.id), {
    partnerLocked: false,
    partnerName: null,
    updatedAt: Date.now(),
  });
  await addLog({
    action: "unpaired",
    text: duty.name + " is free to choose a partner again (" + duty.date + ")",
    date: duty.date,
    by,
  });
}

/** Exam-day attendance. Admin marks it, or the teacher marks themselves. */
export async function markAttendance(
  duty: Duty,
  present: boolean | null,
  by: { email: string; name: string }
): Promise<void> {
  await updateDoc(doc(getDb(), "duties", duty.id), {
    present,
    markedAt: present === null ? null : Date.now(),
    markedBy: present === null ? null : by.name,
    updatedAt: Date.now(),
  });
}

/** Admin moves one teacher to another room by hand. */
export async function moveDuty(duty: Duty, room: ExamRoomPlan, by: { email: string; name: string }): Promise<void> {
  // Moving somebody breaks whatever pair they were in, so the lock goes too.
  await updateDoc(doc(getDb(), "duties", duty.id), {
    roomId: room.roomId,
    roomName: room.roomName,
    partnerLocked: false,
    partnerName: null,
    updatedAt: Date.now(),
  });
  await addLog({
    action: "moved",
    text: duty.name + " moved to " + room.roomName + " on " + duty.date,
    date: duty.date,
    by,
  });
}

/** Admin adds one teacher to a room outside the draw. */
export async function addDuty(opts: {
  day: ExamDay;
  room: ExamRoomPlan;
  person: { email: string; name: string };
  by: { email: string; name: string };
}): Promise<void> {
  const now = Date.now();
  const id = dutyId(opts.day.date, opts.person.email);
  const db = getDb();
  const batch = writeBatch(db);
  batch.set(doc(db, "duties", id), {
    id,
    date: opts.day.date,
    email: cleanEmail(opts.person.email),
    name: opts.person.name,
    roomId: opts.room.roomId,
    roomName: opts.room.roomName,
    startSlot: opts.day.startSlot,
    endSlot: opts.day.endSlot,
    startsAt: examStartMs(opts.day.date, opts.day.startSlot),
    status: "assigned",
    skipReason: "",
    skipAt: null,
    partnerRequestTo: null,
    partnerRequestAt: null,
    partnerLocked: false,
    partnerName: null,
    present: null,
    markedAt: null,
    markedBy: null,
    assignedAt: now,
    updatedAt: now,
  } as Duty);
  await batch.commit();
  await addLog({
    action: "added",
    text: opts.person.name + " added to " + opts.room.roomName + " on " + opts.day.date,
    date: opts.day.date,
    by: opts.by,
  });
}

export async function removeDuty(duty: Duty, by: { email: string; name: string }): Promise<void> {
  await deleteDoc(doc(getDb(), "duties", duty.id));
  await addLog({
    action: "removed",
    text: duty.name + " taken off " + duty.roomName + " on " + duty.date,
    date: duty.date,
    by,
  });
}

// ------------------------------------------------------------
//  Log - admin only, append only
// ------------------------------------------------------------

export async function addLog(entry: {
  action: string;
  text: string;
  date?: string;
  by: { email: string; name: string };
}): Promise<void> {
  const id = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8);
  await setDoc(doc(getDb(), "invigLog", id), {
    id,
    ts: Date.now(),
    action: entry.action,
    text: entry.text,
    date: entry.date || "",
    byEmail: cleanEmail(entry.by.email),
    byName: entry.by.name,
  });
}

export function subscribeLog(
  cb: (entries: { id: string; ts: number; action: string; text: string; date: string; byName: string }[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), "invigLog"),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as { id: string; ts: number; action: string; text: string; date: string; byName: string });
      list.sort((a, b) => b.ts - a.ts);
      cb(list.slice(0, 200));
    },
    (e) => onError?.(e)
  );
}
