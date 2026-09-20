// ============================================================
//  Keeping the board equal to the sheets.
//
//  Runs on the server only (Firebase Admin), and is the single
//  place that writes sheet-driven bookings.
//
//  HOW IT STAYS CHEAP
//
//  Every visitor opening the Day Board pings this. Almost every
//  one of those pings must cost nothing, so there are two gates
//  before any writing happens:
//
//    1. If the last check was under ten minutes ago, stop. One
//       small read, nothing else.
//    2. Otherwise download both sheets and hash what they say.
//       If the hash is unchanged AND the fortnight-ahead window
//       has not rolled on, stop. Two downloads, one write.
//
//  Only a real edit to a sheet (or a new day coming into range)
//  gets as far as reading and rewriting bookings.
//
//  WHAT IT OWNS
//
//  Sheet-driven bookings have a deterministic id - tt_<date>_
//  <room>_<slot> - so re-running is an overwrite, never a
//  duplicate. Anything with that id, or left over from the old
//  seed script, belongs to the sync and will be corrected or
//  removed to match the sheets. A booking a teacher made by hand
//  is never silently deleted: if the timetable needs that room at
//  that hour, the booking is CANCELLED, with the reason on it and
//  a notice posted, so it stays visible and can be reinstated.
// ============================================================

import { createHash } from "node:crypto";
import { adminDb } from "../firebaseAdmin";
import { slotRange } from "../slots";
import type { Booking, Room } from "../types";
import { FRESH_FOR_MS, HORIZON_WEEKS, SHEETS, SYNC_DOC } from "./config";
import { htmlFromZip } from "./sheetGrid";
import { parseSheet } from "./sheetTimetable";
import { planTimetable, type WeeklyTemplate } from "./plan";

export interface SyncReport {
  ok: boolean;
  /** "fresh" | "unchanged" | "synced" | "failed" */
  outcome: "fresh" | "unchanged" | "synced" | "failed";
  checkedAt: number;
  created: number;
  updated: number;
  removed: number;
  /** Teachers' own bookings cancelled to make room for the timetable. */
  displaced: string[];
  /** Rows the sheets contain that could not be placed. */
  problems: string[];
  sessionsFound: number;
  from: string;
  to: string;
  /** True when this was a preview and nothing was written. */
  dryRun?: boolean;
  error?: string;
}

/** Bookings this sync owns carry this id prefix. */
const ID_PREFIX = "tt_";

/** Old `npm run seed-timetable` rows, which this replaces. */
const LEGACY_UIDS = /^(seed-teacher-|seed-exam-)/;

export interface SyncOptions {
  /** Skip the ten-minute wait and re-read the sheets now. Admin only. */
  force?: boolean;
  /**
   * Work out every change and report it, but write nothing at all -
   * not the bookings, not the locks, not even the "last checked"
   * stamp. What a careful admin wants before letting a sheet edit
   * loose on a live board, and how this was tested against real data
   * without touching it.
   */
  dryRun?: boolean;
}

export async function runTimetableSync(options: SyncOptions = {}): Promise<SyncReport> {
  const db = adminDb();
  const stateRef = db.collection("config").doc(SYNC_DOC);
  const now = Date.now();
  const from = istToday();
  const to = shiftDays(from, HORIZON_WEEKS * 7 - 1);

  const base: SyncReport = {
    ok: true, outcome: "fresh", checkedAt: now,
    created: 0, updated: 0, removed: 0,
    displaced: [], problems: [], sessionsFound: 0, from, to,
  };

  const stateSnap = await stateRef.get();
  const state = (stateSnap.data() || {}) as Record<string, unknown>;

  if (!options.force && !options.dryRun && typeof state.checkedAt === "number" && now - state.checkedAt < FRESH_FOR_MS) {
    return { ...base, outcome: "fresh", checkedAt: state.checkedAt, ...carryOver(state) };
  }

  try {
    // ---- 1. read the sheets ----
    const inputs = [];
    let sessionsFound = 0;
    const problems: string[] = [];
    for (const source of SHEETS) {
      const html = htmlFromZip(await downloadSheet(source.id, source.label));
      const parsed = parseSheet(html);
      sessionsFound += parsed.sessions.length;
      problems.push(...parsed.warnings.map((w) => source.label + ": " + w));
      inputs.push({ source, sessions: parsed.sessions });
    }

    const rooms = await loadRooms(db);
    const plan = planTimetable(inputs, rooms);
    problems.push(...plan.problems);

    // ---- 2. has anything actually changed? ----
    const contentHash = hashTemplates(plan.templates);
    if (!options.force && !options.dryRun && state.contentHash === contentHash && state.to === to) {
      const report: SyncReport = {
        ...base, outcome: "unchanged", sessionsFound, problems,
        created: numberOr(state.created), updated: 0, removed: numberOr(state.removed),
        displaced: stringsOr(state.displaced),
      };
      await stateRef.set({ ...reportToState(report), contentHash }, { merge: true });
      return report;
    }

    // ---- 3. reconcile ----
    const desired = expand(plan.templates, from, to);
    const result = await reconcile(db, desired, from, to, rooms, Boolean(options.dryRun));

    const report: SyncReport = {
      ...base, outcome: "synced", sessionsFound, problems,
      created: result.created, updated: result.updated,
      removed: result.removed, displaced: result.displaced,
      dryRun: Boolean(options.dryRun),
    };
    if (!options.dryRun) {
      await stateRef.set({ ...reportToState(report), contentHash }, { merge: true });
    }
    return report;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const report: SyncReport = { ...base, ok: false, outcome: "failed", error: message, dryRun: Boolean(options.dryRun) };
    // Record the failure but do NOT stamp contentHash, so the next
    // attempt retries in full rather than believing it is up to date.
    if (!options.dryRun) {
      await stateRef.set({ checkedAt: now, lastError: message, lastErrorAt: now }, { merge: true });
    }
    return report;
  }
}

// ------------------------------------------------------------
//  Downloading
// ------------------------------------------------------------

/**
 * `export?format=zip` is a zip of static HTML, and unlike the CSV
 * export it keeps merged cells - which is the only place a sheet
 * records how long a class runs. See sheetGrid.ts for the full story.
 */
async function downloadSheet(id: string, label: string): Promise<Buffer> {
  const url = "https://docs.google.com/spreadsheets/d/" + id + "/export?format=zip";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) {
      throw new Error(
        "Could not read the " + label + " sheet (HTTP " + res.status + "). " +
        (res.status === 401 || res.status === 403
          ? "Check it is still shared as “Anyone with the link can view”."
          : "Google may be temporarily unavailable.")
      );
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Timed out reading the " + label + " sheet from Google.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function loadRooms(db: FirebaseFirestore.Firestore): Promise<Room[]> {
  const snap = await db.collection("rooms").get();
  if (snap.empty) throw new Error("No rooms are set up yet — run the campus seed first.");
  return snap.docs.map((d) => ({ ...(d.data() as Room), id: d.id }));
}

// ------------------------------------------------------------
//  Planning concrete dates
// ------------------------------------------------------------

interface PlannedBooking {
  id: string;
  date: string;
  template: WeeklyTemplate;
  fingerprint: string;
}

function expand(templates: WeeklyTemplate[], from: string, to: string): Map<string, PlannedBooking> {
  const out = new Map<string, PlannedBooking>();
  for (let date = from; date <= to; date = shiftDays(date, 1)) {
    const weekday = weekdayOf(date);
    for (const t of templates) {
      if (t.weekday !== weekday) continue;
      const id = ID_PREFIX + date + "_" + t.roomId + "_" + t.startSlot;
      out.set(id, { id, date, template: t, fingerprint: fingerprint(date, t) });
    }
  }
  return out;
}

/** Everything a change to which should rewrite the booking. */
function fingerprint(date: string, t: WeeklyTemplate): string {
  return [
    date, t.roomId, t.startSlot, t.endSlot, t.kind, t.subject, t.title,
    t.facultyUid, t.facultyName, t.years.join(","), [...t.batchIds].sort().join(","), t.note,
  ].join("|");
}

function hashTemplates(templates: WeeklyTemplate[]): string {
  const canonical = templates
    .map((t) => fingerprint("*", t) + "|" + t.weekday)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

// ------------------------------------------------------------
//  Reconciling
// ------------------------------------------------------------

interface ReconcileResult {
  created: number;
  updated: number;
  removed: number;
  displaced: string[];
}

async function reconcile(
  db: FirebaseFirestore.Firestore,
  desired: Map<string, PlannedBooking>,
  from: string,
  to: string,
  rooms: Room[],
  dryRun: boolean
): Promise<ReconcileResult> {
  const snap = await db
    .collection("bookings")
    .where("date", ">=", from)
    .where("date", "<=", to)
    .get();

  const existingSheet = new Map<string, Booking>();
  const manual: Booking[] = [];
  for (const d of snap.docs) {
    const booking = { ...(d.data() as Booking), id: d.id };
    if (isSheetOwned(d.id, booking)) existingSheet.set(d.id, booking);
    else if (booking.status === "confirmed") manual.push(booking);
  }

  const result: ReconcileResult = { created: 0, updated: 0, removed: 0, displaced: [] };
  const now = Date.now();

  // Every lock this run wants gone, and every lock it wants written.
  // Collected up front rather than written as we go, because a lock
  // doc can easily be BOTH - an old row shrinking out of an hour that
  // the row replacing it still needs - and the batches these would
  // land in are committed concurrently, so a stray delete could
  // overtake its own replacement and leave the room reading free.
  // Resolving it here means no lock is ever deleted and rewritten.
  const lockDeletes = new Set<string>();
  const lockWrites = new Map<string, FirebaseFirestore.DocumentData>();
  const bookingWrites: { id: string; data: FirebaseFirestore.DocumentData }[] = [];
  const bookingDeletes: string[] = [];
  const bookingUpdates: { id: string; data: FirebaseFirestore.DocumentData }[] = [];
  const noticeWrites: FirebaseFirestore.DocumentData[] = [];

  // --- a. sheet bookings the sheets no longer ask for ---
  for (const [id, booking] of existingSheet) {
    if (desired.has(id)) continue; // kept, and rewritten below if changed
    bookingDeletes.push(id);
    for (const key of lockKeys(booking)) lockDeletes.add(key);
    result.removed++;
  }

  // --- b. a teacher's own booking standing where the timetable goes ---
  const wanted = slotsWanted(desired);
  for (const booking of manual) {
    const hit = firstClash(booking, wanted);
    if (!hit) continue;
    const roomName = rooms.find((r) => r.id === booking.roomId)?.name || booking.roomId;
    const reason = "The official timetable now uses " + roomName + " at this hour (" + hit + ").";
    bookingUpdates.push({
      id: booking.id,
      data: { status: "cancelled", cancelReason: reason, updatedAt: now },
    });
    for (const key of lockKeys(booking)) lockDeletes.add(key);
    noticeWrites.push({
      kind: "cancelled",
      bookingId: booking.id,
      text:
        "CANCELLED — " + booking.subject + " (" + booking.title + ") in " + roomName +
        " on " + booking.date + " " + slotRange(booking.startSlot, booking.endSlot) +
        ". Reason: " + reason,
      batchIds: booking.batchIds || [],
      years: booking.years || [],
      byUid: "timetable-sync",
      byName: "Timetable sync",
      createdAt: now,
    });
    result.displaced.push(
      booking.facultyName + " — " + booking.subject + " in " + roomName + ", " +
      booking.date + " " + slotRange(booking.startSlot, booking.endSlot)
    );
  }

  // --- c. what the sheets say ---
  for (const [id, planned] of desired) {
    const existing = existingSheet.get(id);
    const t = planned.template;

    // Claim the hours whether or not the booking itself changed: a
    // lock can go missing on its own (an old row removed above may
    // have been sitting on it), and re-writing an identical lock
    // costs one small document.
    for (let s = t.startSlot; s <= t.endSlot; s++) {
      lockWrites.set(planned.date + "_" + t.roomId + "_" + s, {
        bookingId: id,
        date: planned.date,
        roomId: t.roomId,
        slot: s,
        facultyUid: t.facultyUid,
        facultyName: t.facultyName,
        title: t.title,
        subject: t.subject,
      });
    }

    if (existing && sameAsPlanned(existing, planned)) continue;

    // A rewritten booking can be SHORTER than the one it replaces;
    // the hours it gives up have to be let go.
    if (existing) for (const key of lockKeys(existing)) lockDeletes.add(key);

    bookingWrites.push({
      id,
      data: {
        date: planned.date,
        roomId: t.roomId,
        startSlot: t.startSlot,
        endSlot: t.endSlot,
        kind: t.kind,
        subject: t.subject,
        title: t.title,
        facultyUid: t.facultyUid,
        facultyName: t.facultyName,
        years: t.years,
        batchIds: t.batchIds,
        note: t.note,
        status: "confirmed",
        // The official timetable IS the schedule. It is not a request
        // waiting on anybody's approval.
        approved: true,
        movedFrom: null,
        seriesId: null,
        seriesUntil: null,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        source: "sheet",
        sheetFingerprint: planned.fingerprint,
      },
    });

    if (existing) result.updated++;
    else result.created++;
  }

  // --- d. commit ---
  if (dryRun) return result;

  const writer = new BatchWriter(db);
  for (const id of bookingDeletes) writer.delete(db.collection("bookings").doc(id));
  for (const u of bookingUpdates) writer.update(db.collection("bookings").doc(u.id), u.data);
  for (const n of noticeWrites) writer.set(db.collection("notices").doc(), n);
  for (const w of bookingWrites) writer.set(db.collection("bookings").doc(w.id), w.data);
  for (const key of lockDeletes) {
    if (!lockWrites.has(key)) writer.delete(db.collection("slotLocks").doc(key));
  }
  for (const [key, data] of lockWrites) writer.set(db.collection("slotLocks").doc(key), data);
  await writer.flush();

  return result;
}

function lockKeys(booking: Booking): string[] {
  const out: string[] = [];
  for (let s = booking.startSlot; s <= booking.endSlot; s++) {
    out.push(booking.date + "_" + booking.roomId + "_" + s);
  }
  return out;
}

function isSheetOwned(id: string, booking: Booking): boolean {
  if (id.startsWith(ID_PREFIX)) return true;
  if ((booking as { source?: string }).source === "sheet") return true;
  // Rows left behind by the old `npm run seed-timetable`, which this
  // replaces. Adopting them means the first sync corrects the board
  // instead of laying a second copy of the timetable on top of it.
  return typeof booking.facultyUid === "string" && LEGACY_UIDS.test(booking.facultyUid);
}

function sameAsPlanned(booking: Booking, planned: PlannedBooking): boolean {
  return (
    (booking as { sheetFingerprint?: string }).sheetFingerprint === planned.fingerprint &&
    booking.status === "confirmed"
  );
}

/** date|roomId|slot -> a label for the class that wants it. */
function slotsWanted(desired: Map<string, PlannedBooking>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of desired.values()) {
    for (let s = p.template.startSlot; s <= p.template.endSlot; s++) {
      out.set(p.date + "|" + p.template.roomId + "|" + s, p.template.title);
    }
  }
  return out;
}

function firstClash(booking: Booking, wanted: Map<string, string>): string | null {
  for (let s = booking.startSlot; s <= booking.endSlot; s++) {
    const label = wanted.get(booking.date + "|" + booking.roomId + "|" + s);
    if (label) return label;
  }
  return null;
}

/**
 * Firestore takes at most 500 operations per batch, and a full
 * semester of timetable is thousands. This just keeps filling and
 * posting batches so callers can write as if there were no limit.
 */
class BatchWriter {
  private db: FirebaseFirestore.Firestore;
  private batch: FirebaseFirestore.WriteBatch;
  private count = 0;
  private pending: Promise<unknown>[] = [];

  constructor(db: FirebaseFirestore.Firestore) {
    this.db = db;
    this.batch = db.batch();
  }
  private bump() {
    if (++this.count >= 450) {
      this.pending.push(this.batch.commit());
      this.batch = this.db.batch();
      this.count = 0;
    }
  }
  set(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) {
    this.batch.set(ref, data);
    this.bump();
  }
  update(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) {
    this.batch.set(ref, data, { merge: true });
    this.bump();
  }
  delete(ref: FirebaseFirestore.DocumentReference) {
    this.batch.delete(ref);
    this.bump();
  }
  async flush() {
    if (this.count) this.pending.push(this.batch.commit());
    await Promise.all(this.pending);
  }
}

// ------------------------------------------------------------
//  State kept between runs
// ------------------------------------------------------------

function reportToState(r: SyncReport) {
  return {
    checkedAt: r.checkedAt,
    syncedAt: r.outcome === "synced" ? r.checkedAt : undefined,
    outcome: r.outcome,
    from: r.from,
    to: r.to,
    created: r.created,
    updated: r.updated,
    removed: r.removed,
    displaced: r.displaced.slice(0, 50),
    problems: r.problems.slice(0, 50),
    sessionsFound: r.sessionsFound,
    lastError: null,
  };
}

function carryOver(state: Record<string, unknown>) {
  return {
    problems: stringsOr(state.problems),
    displaced: stringsOr(state.displaced),
    sessionsFound: numberOr(state.sessionsFound),
  };
}

function numberOr(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function stringsOr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ------------------------------------------------------------
//  Dates
//
//  Vercel's functions run in UTC. The campus does not, so "today"
//  has to be worked out in India Standard Time (UTC+5:30, no DST)
//  or an evening sync books the wrong day.
// ------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istToday(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return iso(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

function iso(y: number, m: number, d: number): string {
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

function shiftDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}
