"use client";

// ============================================================
//  Every read and write against Firestore.
//
//  THE IMPORTANT BIT - how double booking is made impossible:
//
//  Each occupied hour gets its own tiny document in `slotLocks`
//  with a deterministic id:  <date>_<roomId>_<slot>
//
//  Booking C-6 for 09:30-11:30 therefore means creating
//  slotLocks/2026-09-07_c6_1 and slotLocks/2026-09-07_c6_2.
//
//  All of that happens inside runTransaction(). Firestore reads
//  those documents, and if ANY of them already exists the whole
//  transaction is thrown away and the teacher is told who holds
//  the room. If two teachers press Confirm in the same instant,
//  Firestore serialises the transactions - one succeeds, the
//  other retries, sees the lock and fails cleanly.
//
//  There is no window in which both can win.
// ============================================================

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { slotRange } from "./slots";
import { shiftDays, shortDate, weekdayName } from "./dates";
import type { Batch, Booking, Kind, Notice, Room, RosterEntry, SlotLock, UserProfile } from "./types";

export function lockId(date: string, roomId: string, slot: number): string {
  return date + "_" + roomId + "_" + slot;
}

/**
 * Looks a student up by email BEFORE they've ever signed in - see
 * RosterEntry. A one-time read (not a live subscription): onboarding
 * only needs this once, at the moment the form loads. Returns null for
 * anyone not pre-loaded (e.g. 1st years, until that roster is added).
 */
export async function getRosterEntry(email: string): Promise<RosterEntry | null> {
  const snap = await getDoc(doc(getDb(), "roster", email.toLowerCase()));
  return snap.exists() ? (snap.data() as RosterEntry) : null;
}

/**
 * Every pre-loaded roster row for one batch, name included - this is
 * what lets Admin -> Batches show who's actually in a batch (sorted by
 * name) without waiting for each of them to sign in first. Admin-only
 * read (see firestore.rules); everyone else can only read their own
 * roster row.
 */
export async function getRosterByBatch(batchId: string): Promise<RosterEntry[]> {
  const snap = await getDocs(query(collection(getDb(), "roster"), where("batchId", "==", batchId)));
  return snap.docs
    .map((d) => d.data() as RosterEntry)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "") || a.email.localeCompare(b.email));
}

/** Thrown when a room is already taken. Carries who holds it. */
export class BookingConflict extends Error {
  constructor(public detail: string) {
    super(detail);
    this.name = "BookingConflict";
  }
}

// ------------------------------------------------------------
//  Live subscriptions
// ------------------------------------------------------------

export function subscribeRooms(cb: (rooms: Room[]) => void, onError?: (e: Error) => void): Unsubscribe {
  // Sorting happens here rather than in the query so that Firestore never
  // needs a composite index. Index builds take minutes and would stall a
  // fresh deployment; a campus has a handful of rooms, so JS is plenty.
  return onSnapshot(
    collection(getDb(), "rooms"),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Room), id: d.id }));
      list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

export function subscribeBatches(cb: (batches: Batch[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    collection(getDb(), "batches"),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Batch), id: d.id }));
      list.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

/**
 * Bookings between `fromDate` and `toDate` (inclusive), a range on the
 * SAME field so it needs no composite index. Callers pass whatever
 * window they actually need on screen - the day board asks for just
 * one day, the calendar for just the visible month, the admin
 * timetable editor for the next couple of weeks - instead of one
 * shared subscription loading the whole year's schedule for every
 * viewer on every page, which is what used to blow through Firestore's
 * daily free quota on a normal day with a few hundred real users.
 */
export function subscribeBookingsInRange(
  fromDate: string,
  toDate: string,
  cb: (bookings: Booking[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "bookings"), where("date", ">=", fromDate), where("date", "<=", toDate)),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Booking), id: d.id }));
      list.sort((a, b) => a.date.localeCompare(b.date) || a.startSlot - b.startSlot);
      cb(list);
    },
    (e) => onError?.(e)
  );
}

/**
 * One teacher's own bookings, past and future. Scoped by facultyUid
 * (single-field equality, no composite index needed) rather than by
 * date range, since one person's own classes are naturally a small,
 * bounded set regardless of the horizon - unlike the shared board,
 * which is why "My bookings" doesn't need a date window at all.
 */
export function subscribeMyBookings(
  facultyUid: string,
  cb: (bookings: Booking[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "bookings"), where("facultyUid", "==", facultyUid)),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Booking), id: d.id }));
      list.sort((a, b) => a.date.localeCompare(b.date) || a.startSlot - b.startSlot);
      cb(list);
    },
    (e) => onError?.(e)
  );
}

/**
 * The most recent notices only (default 150) - ordered and limited in
 * the query itself, not fetched-then-sliced, so a growing history
 * doesn't mean every viewer re-reads the entire collection forever.
 */
export function subscribeNotices(
  cb: (n: Notice[]) => void,
  onError?: (e: Error) => void,
  max = 150
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "notices"), orderBy("createdAt", "desc"), limit(max)),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Notice), id: d.id }));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

export function subscribeUsers(cb: (u: UserProfile[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    collection(getDb(), "users"),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as UserProfile), uid: d.id }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      cb(list);
    },
    (e) => onError?.(e)
  );
}

// ------------------------------------------------------------
//  Booking writes
// ------------------------------------------------------------

export interface NewBookingInput {
  date: string;
  roomId: string;
  roomName: string;
  startSlot: number;
  endSlot: number;
  kind: Kind;
  subject: string;
  title: string;
  facultyUid: string;
  facultyName: string;
  years: number[];
  batchIds: string[];
  note: string;
}

/**
 * The transaction shared by a single booking and every occurrence of
 * a recurring one. It claims the hours and writes the booking, but -
 * unlike `createBooking` - does NOT post a notice, because a 15-week
 * series calls this 15 times and must end up with exactly ONE notice,
 * not fifteen identical ones.
 */
async function writeBookingOccurrence(
  input: NewBookingInput,
  series: { seriesId: string | null; seriesUntil: string | null }
): Promise<string> {
  const db = getDb();
  const now = Date.now();

  return runTransaction(db, async (tx) => {
    const lockRefs = [];
    for (let s = input.startSlot; s <= input.endSlot; s++) {
      lockRefs.push({ slot: s, ref: doc(db, "slotLocks", lockId(input.date, input.roomId, s)) });
    }

    // ---- all reads first (Firestore requires this) ----
    const snaps = await Promise.all(lockRefs.map((l) => tx.get(l.ref)));

    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].exists()) {
        const held = snaps[i].data() as SlotLock;
        throw new BookingConflict(
          input.roomName +
            " is already taken at " +
            hourLabel(lockRefs[i].slot) +
            ' — "' +
            held.title +
            '" (' +
            held.subject +
            ") by " +
            held.facultyName +
            "."
        );
      }
    }

    // ---- then all writes ----
    const bookingRef = doc(collection(db, "bookings"));
    const booking: Omit<Booking, "id"> = {
      date: input.date,
      roomId: input.roomId,
      startSlot: input.startSlot,
      endSlot: input.endSlot,
      kind: input.kind,
      subject: input.subject,
      title: input.title,
      facultyUid: input.facultyUid,
      facultyName: input.facultyName,
      years: input.years,
      batchIds: input.batchIds,
      note: input.note,
      status: "confirmed",
      movedFrom: null,
      seriesId: series.seriesId,
      seriesUntil: series.seriesUntil,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(bookingRef, booking);

    for (const l of lockRefs) {
      const lock: SlotLock = {
        bookingId: bookingRef.id,
        date: input.date,
        roomId: input.roomId,
        slot: l.slot,
        facultyUid: input.facultyUid,
        facultyName: input.facultyName,
        title: input.title,
        subject: input.subject,
      };
      tx.set(l.ref, lock);
    }

    return bookingRef.id;
  });
}

/**
 * Claims every hour from startSlot to endSlot in one atomic step.
 * Resolves with the new booking id, or throws BookingConflict.
 */
export async function createBooking(input: NewBookingInput): Promise<string> {
  const id = await writeBookingOccurrence(input, { seriesId: null, seriesUntil: null });

  await addDoc(collection(getDb(), "notices"), noticeRecord({
    kind: "booked",
    bookingId: id,
    text:
      input.subject + " — " + input.title + " · " + input.roomName + " · " +
      shortDate(input.date) + " " + slotRange(input.startSlot, input.endSlot),
    batchIds: input.batchIds,
    years: input.years,
    byUid: input.facultyUid,
    byName: input.facultyName,
  }));

  return id;
}

export interface RecurringBookingResult {
  seriesId: string | null;
  firstBookingId: string | null;
  bookedDates: string[];
  skipped: { date: string; reason: string }[];
}

/**
 * Books the same room and hours every week, on the same weekday as
 * `input.date`, up to and including `untilDate`.
 *
 * Each week is its own transaction and its own conflict check - a
 * clash on one week (a holiday someone already booked over, say)
 * skips only that week rather than failing the whole semester. The
 * caller gets back exactly which dates landed and which didn't, and
 * only ONE notice is posted for the whole series.
 *
 * `actor` is who actually DID this, for the notice's byline - normally
 * that's the same person as input.facultyUid/facultyName (a teacher
 * booking their own class), so it defaults to that. It's only ever
 * different when an admin is booking or editing a series on someone
 * else's behalf from Admin -> Timetable - without this, that notice
 * said "by <the teacher>" even though the teacher never touched
 * anything, which just looked like a lie about who made the change.
 */
export async function createRecurringBooking(
  input: NewBookingInput,
  untilDate: string,
  actor?: { uid: string; name: string }
): Promise<RecurringBookingResult> {
  const dates: string[] = [];
  for (let d = input.date; d <= untilDate; d = shiftDays(d, 7)) dates.push(d);

  if (dates.length === 0) {
    return { seriesId: null, firstBookingId: null, bookedDates: [], skipped: [] };
  }

  // A random id purely for grouping the series - it does not need to be
  // any particular occurrence's own document id, just unique.
  const seriesId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "series-" + Date.now() + "-" + Math.random().toString(36).slice(2);

  let firstBookingId: string | null = null;
  const bookedDates: string[] = [];
  const skipped: { date: string; reason: string }[] = [];

  for (const date of dates) {
    try {
      const id = await writeBookingOccurrence({ ...input, date }, { seriesId, seriesUntil: untilDate });
      firstBookingId = firstBookingId ?? id;
      bookedDates.push(date);
    } catch (e) {
      skipped.push({
        date,
        reason: e instanceof BookingConflict ? e.detail : e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  if (bookedDates.length > 0 && firstBookingId) {
    const weekday = weekdayName(input.date);
    const text =
      input.subject + " — " + input.title + " · " + input.roomName + " · every " + weekday + ", " +
      slotRange(input.startSlot, input.endSlot) + ", " + shortDate(bookedDates[0]) + " to " +
      shortDate(bookedDates[bookedDates.length - 1]) + " (" + bookedDates.length + " week" +
      (bookedDates.length === 1 ? "" : "s") + ")" +
      (skipped.length ? " — " + skipped.length + " week" + (skipped.length === 1 ? "" : "s") + " skipped, already taken" : "");

    await addDoc(collection(getDb(), "notices"), noticeRecord({
      kind: "booked",
      bookingId: firstBookingId,
      text,
      batchIds: input.batchIds,
      years: input.years,
      byUid: actor?.uid || input.facultyUid,
      byName: actor?.name || input.facultyName,
    }));
  }

  return { seriesId, firstBookingId, bookedDates, skipped };
}

/**
 * Marks a session cancelled and releases its hours so another
 * teacher can use the room. The booking stays on the board struck
 * through in grey so nobody turns up.
 */
export async function cancelBooking(
  booking: Booking,
  roomName: string,
  reason: string,
  byUid: string,
  byName: string
): Promise<void> {
  const db = getDb();
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "bookings", booking.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("That booking has already been removed.");

    tx.update(ref, { status: "cancelled", cancelReason: reason, updatedAt: Date.now() });

    for (let s = booking.startSlot; s <= booking.endSlot; s++) {
      tx.delete(doc(db, "slotLocks", lockId(booking.date, booking.roomId, s)));
    }

    tx.set(doc(collection(db, "notices")), noticeRecord({
      kind: "cancelled",
      bookingId: booking.id,
      text:
        "CANCELLED — " + booking.subject + " (" + booking.title + ") in " + roomName + " on " +
        shortDate(booking.date) + " " + slotRange(booking.startSlot, booking.endSlot) +
        (reason ? ". Reason: " + reason : ""),
      batchIds: booking.batchIds,
      years: booking.years,
      byUid,
      byName,
    }));
  });
}

/**
 * Cancels this occurrence and every later occurrence of the same
 * weekly series, freeing all their rooms. Posts exactly ONE combined
 * notice rather than one per week. `allBookings` is the already-loaded
 * list from useCampus() - this never queries Firestore for it, so it
 * only reaches as far into the future as that list already covers.
 */
export async function cancelSeriesFromDate(
  seriesId: string,
  fromDate: string,
  allBookings: Booking[],
  roomName: string,
  reason: string,
  byUid: string,
  byName: string
): Promise<number> {
  const db = getDb();
  const toCancel = allBookings
    .filter((b) => b.seriesId === seriesId && b.date >= fromDate && b.status === "confirmed")
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const b of toCancel) {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "bookings", b.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      tx.update(ref, { status: "cancelled", cancelReason: reason, updatedAt: Date.now() });
      for (let s = b.startSlot; s <= b.endSlot; s++) {
        tx.delete(doc(db, "slotLocks", lockId(b.date, b.roomId, s)));
      }
    });
  }

  if (toCancel.length > 0) {
    const first = toCancel[0];
    await addDoc(collection(db, "notices"), noticeRecord({
      kind: "cancelled",
      bookingId: first.id,
      text:
        "CANCELLED (series) — " + first.subject + " (" + first.title + ") in " + roomName +
        ", every " + weekdayName(first.date) + " from " + shortDate(fromDate) + " onward" +
        " (" + toCancel.length + " session" + (toCancel.length === 1 ? "" : "s") + ")" +
        (reason ? ". Reason: " + reason : ""),
      batchIds: first.batchIds,
      years: first.years,
      byUid,
      byName,
    }));
  }

  return toCancel.length;
}

/** Puts a cancelled session back, if its hours are still free. */
export async function reinstateBooking(
  booking: Booking,
  roomName: string,
  byUid: string,
  byName: string
): Promise<void> {
  const db = getDb();
  await runTransaction(db, async (tx) => {
    const lockRefs = [];
    for (let s = booking.startSlot; s <= booking.endSlot; s++) {
      lockRefs.push({ slot: s, ref: doc(db, "slotLocks", lockId(booking.date, booking.roomId, s)) });
    }
    const snaps = await Promise.all(lockRefs.map((l) => tx.get(l.ref)));
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].exists()) {
        const held = snaps[i].data() as SlotLock;
        throw new BookingConflict(
          roomName + " was taken while this was cancelled — " + held.facultyName +
          ' now holds ' + hourLabel(lockRefs[i].slot) + '. Move the session to another room instead.'
        );
      }
    }

    tx.update(doc(db, "bookings", booking.id), {
      status: "confirmed",
      cancelReason: "",
      updatedAt: Date.now(),
    });
    for (const l of lockRefs) {
      tx.set(l.ref, {
        bookingId: booking.id,
        date: booking.date,
        roomId: booking.roomId,
        slot: l.slot,
        facultyUid: booking.facultyUid,
        facultyName: booking.facultyName,
        title: booking.title,
        subject: booking.subject,
      } satisfies SlotLock);
    }

    tx.set(doc(collection(db, "notices")), noticeRecord({
      kind: "reinstated",
      bookingId: booking.id,
      text:
        "BACK ON — " + booking.subject + " (" + booking.title + ") in " + roomName + " on " +
        shortDate(booking.date) + " " + slotRange(booking.startSlot, booking.endSlot),
      batchIds: booking.batchIds,
      years: booking.years,
      byUid,
      byName,
    }));
  });
}

/** Moves a session to another room, atomically. */
export async function moveBooking(
  booking: Booking,
  toRoomId: string,
  fromRoomName: string,
  toRoomName: string,
  byUid: string,
  byName: string
): Promise<void> {
  if (toRoomId === booking.roomId) throw new Error("That is already the room.");
  const db = getDb();

  await runTransaction(db, async (tx) => {
    const newLocks = [];
    for (let s = booking.startSlot; s <= booking.endSlot; s++) {
      newLocks.push({ slot: s, ref: doc(db, "slotLocks", lockId(booking.date, toRoomId, s)) });
    }
    const snaps = await Promise.all(newLocks.map((l) => tx.get(l.ref)));
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].exists()) {
        const held = snaps[i].data() as SlotLock;
        throw new BookingConflict(
          toRoomName + " is not free at " + hourLabel(newLocks[i].slot) +
          " — " + held.facultyName + ' holds it for "' + held.title + '".'
        );
      }
    }

    // release the old room
    for (let s = booking.startSlot; s <= booking.endSlot; s++) {
      tx.delete(doc(db, "slotLocks", lockId(booking.date, booking.roomId, s)));
    }
    // claim the new one
    for (const l of newLocks) {
      tx.set(l.ref, {
        bookingId: booking.id,
        date: booking.date,
        roomId: toRoomId,
        slot: l.slot,
        facultyUid: booking.facultyUid,
        facultyName: booking.facultyName,
        title: booking.title,
        subject: booking.subject,
      } satisfies SlotLock);
    }

    tx.update(doc(db, "bookings", booking.id), {
      roomId: toRoomId,
      movedFrom: booking.roomId,
      updatedAt: Date.now(),
    });

    tx.set(doc(collection(db, "notices")), noticeRecord({
      kind: "moved",
      bookingId: booking.id,
      text:
        "ROOM CHANGE — " + booking.subject + " (" + booking.title + ") on " +
        shortDate(booking.date) + " " + slotRange(booking.startSlot, booking.endSlot) +
        " moves from " + fromRoomName + " to " + toRoomName,
      batchIds: booking.batchIds,
      years: booking.years,
      byUid,
      byName,
    }));
  });
}

/** Removes a booking and its hours entirely. */
export async function deleteBooking(booking: Booking): Promise<void> {
  const db = getDb();
  await runTransaction(db, async (tx) => {
    tx.delete(doc(db, "bookings", booking.id));
    for (let s = booking.startSlot; s <= booking.endSlot; s++) {
      tx.delete(doc(db, "slotLocks", lockId(booking.date, booking.roomId, s)));
    }
  });
}

// ------------------------------------------------------------
//  Admin writes
// ------------------------------------------------------------

export async function upsertRoom(room: Room): Promise<void> {
  await setDoc(doc(getDb(), "rooms", room.id), room);
}

/**
 * Removes a room from the campus list entirely. Existing bookings in
 * that room are left exactly as they are - deleting a room is about
 * not offering it for NEW bookings going forward, not erasing history.
 * If you just want it off the board without losing anything already
 * booked in it, turn its "On board" toggle off instead - that's
 * reversible, this isn't.
 */
export async function deleteRoom(roomId: string): Promise<void> {
  await deleteDoc(doc(getDb(), "rooms", roomId));
}

export async function upsertBatch(batch: Batch): Promise<void> {
  await setDoc(doc(getDb(), "batches", batch.id), batch);
}

export async function deleteBatch(batchId: string): Promise<void> {
  await deleteDoc(doc(getDb(), "batches", batchId));
}

export async function setUserRole(uid: string, role: UserProfile["role"]): Promise<void> {
  await updateDoc(doc(getDb(), "users", uid), { role, updatedAt: Date.now() });
}

export async function setUserSubjects(uid: string, subjects: string[], years: number[]): Promise<void> {
  await updateDoc(doc(getDb(), "users", uid), { subjects, years, updatedAt: Date.now() });
}

/**
 * Removes someone's profile - e.g. a test account like "lol ji" made
 * while trying things out. Only deletes the Firestore profile, not
 * their underlying Google/email sign-in itself (that's not something
 * the app can reach) - if they sign in again afterward, they just go
 * through onboarding again like a brand new person.
 */
export async function deleteUser(uid: string): Promise<void> {
  await deleteDoc(doc(getDb(), "users", uid));
}

export async function addNotice(n: Omit<Notice, "id" | "createdAt">): Promise<void> {
  await addDoc(collection(getDb(), "notices"), { ...n, createdAt: Date.now() });
}

// ------------------------------------------------------------
//  helpers
// ------------------------------------------------------------

function noticeRecord(n: {
  kind: Notice["kind"];
  text: string;
  bookingId: string;
  batchIds: string[];
  years: number[];
  byUid: string;
  byName: string;
}): Omit<Notice, "id"> {
  return { ...n, createdAt: Date.now() };
}

function hourLabel(slot: number): string {
  return slotRange(slot, slot);
}
