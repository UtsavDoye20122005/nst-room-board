// ============================================================
//  From "what the sheets say" to "what the board should show".
//
//  Pure: give it the parsed sheets and the campus's real room
//  list, and it hands back the exact set of bookings the board
//  ought to contain, plus an honest list of everything it could
//  not place. It touches no database, so the sync can show an
//  admin precisely what is about to change before it changes it.
// ============================================================

import { SLOTS } from "../slots";
import type { Kind } from "../types";
import {
  BATCH_MERGES,
  FALLBACK_ROOMS,
  ROOM_ALIASES,
  kindFrom,
  teacherFor,
  type SheetSource,
} from "./config";
import type { SheetSession } from "./sheetTimetable";

/** One repeating slot in the week, before it is spread over real dates. */
export interface WeeklyTemplate {
  /** 1 = Monday ... 5 = Friday. */
  weekday: number;
  roomId: string;
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

export interface PlanResult {
  templates: WeeklyTemplate[];
  /** Everything skipped, in words an admin can act on. */
  problems: string[];
}

export interface SheetInput {
  source: SheetSource;
  sessions: SheetSession[];
}

export interface RoomRef {
  id: string;
  name: string;
}

const KIND_LABEL: Record<string, string> = {
  LEC: "Lecture", LECTURE: "Lecture", LAB: "Lab",
  PRACTICAL: "Practical", TUT: "Tutorial", TUTORIAL: "Tutorial", CLASS: "Class",
};

export function planTimetable(sheets: SheetInput[], rooms: RoomRef[]): PlanResult {
  const problems: string[] = [];
  const templates: WeeklyTemplate[] = [];
  /** weekday|roomId|startSlot -> the template already holding it. */
  const taken = new Map<string, WeeklyTemplate>();

  for (const { source, sessions } of sheets) {
    const allLabels = Object.keys(source.batches);

    for (const session of sessions) {
      const where = source.label + " " + dayName(session.weekday) + " " + clock(session.startMinutes);

      const slots = toSlots(session.startMinutes, session.endMinutes);
      if (!slots) {
        problems.push(where + ': "' + session.raw + '" is outside the teaching day - skipped.');
        continue;
      }

      const batchIds = resolveBatches(session.batchLabels, source);
      if (!batchIds.length) {
        problems.push(where + ': "' + session.raw + '" is against batches this site does not know (' +
          session.batchLabels.join(", ") + ') - skipped.');
        continue;
      }

      const roomIds = resolveRooms(session, rooms);
      if (!roomIds.length) {
        problems.push(where + ': "' + session.raw + '" names no room this site knows' +
          (session.roomNames.length ? " (" + session.roomNames.join(", ") + ")" : "") + " - skipped.");
        continue;
      }

      const kind = kindFrom(session.kindWord, session.subject);
      const teacher = teacherFor(session.subject, kind);
      const title = buildTitle(session, kind, allLabels);

      for (const roomId of roomIds) {
        const template: WeeklyTemplate = {
          weekday: session.weekday,
          roomId,
          startSlot: slots.startSlot,
          endSlot: slots.endSlot,
          kind,
          subject: session.subject,
          title,
          facultyUid: teacher.uid,
          facultyName: teacher.name,
          years: [source.year],
          batchIds,
          note: 'From the official ' + source.label + ' timetable sheet — "' + session.raw + '".',
        };

        const clash = overlapping(taken, template);
        if (clash) {
          // The Friday CONTEST is written on BOTH sheets, in the same
          // five rooms at the same hour, because it is one exam both
          // years sit together. That is not a clash to complain about -
          // it is one session with two years in it.
          if (sameSession(clash, template)) {
            clash.years = unique([...clash.years, ...template.years]).sort();
            clash.batchIds = unique([...clash.batchIds, ...template.batchIds]);
            continue;
          }
          problems.push(
            where + ': "' + session.raw + '" wants ' + roomName(rooms, roomId) + ", but " +
            clash.subject + " (" + clash.title + ") is already there at that hour. Kept " +
            clash.subject + "; check the sheets."
          );
          continue;
        }

        templates.push(template);
        for (let s = template.startSlot; s <= template.endSlot; s++) {
          taken.set(template.weekday + "|" + template.roomId + "|" + s, template);
        }
      }
    }
  }

  return { templates, problems };
}

// ------------------------------------------------------------

function overlapping(
  taken: Map<string, WeeklyTemplate>,
  t: WeeklyTemplate
): WeeklyTemplate | undefined {
  for (let s = t.startSlot; s <= t.endSlot; s++) {
    const held = taken.get(t.weekday + "|" + t.roomId + "|" + s);
    if (held) return held;
  }
  return undefined;
}

/** Same class, written twice because both years sit in it. */
function sameSession(a: WeeklyTemplate, b: WeeklyTemplate): boolean {
  return a.subject === b.subject && a.startSlot === b.startSlot && a.endSlot === b.endSlot && a.kind === b.kind;
}

/**
 * The sheets' columns are not a neat half-hour grid - the day opens
 * with two 15-minute columns and lunch is one long one - so a session
 * can begin or end off this app's half-hour SLOTS. Round outwards
 * when that happens: a room in use for part of a half hour is in use,
 * and showing it free would be the one wrong answer.
 */
function toSlots(startMinutes: number, endMinutes: number): { startSlot: number; endSlot: number } | null {
  let startSlot = -1;
  let endSlot = -1;
  for (const slot of SLOTS) {
    const from = minutesOf(slot.start);
    const to = minutesOf(slot.end);
    if (startSlot < 0 && to > startMinutes) startSlot = slot.index;
    if (from < endMinutes) endSlot = slot.index;
  }
  if (startSlot < 0 || endSlot < startSlot) return null;
  return { startSlot, endSlot };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function resolveBatches(labels: string[], source: SheetSource): string[] {
  const ids = unique(
    labels
      .map((l) => source.batches[l.trim().toUpperCase()] ?? source.batches[l.trim()])
      .filter(Boolean) as string[]
  );
  return collapse(ids);
}

/**
 * A lecture the sheet merges across A1 and A2 is a Batch A lecture -
 * and Batch A is where the real student roster actually is, so it has
 * to be booked there or nobody gets told about it.
 */
function collapse(ids: string[]): string[] {
  let out = [...ids];
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of BATCH_MERGES) {
      if (rule.parts.every((p) => out.includes(p))) {
        out = out.filter((i) => !rule.parts.includes(i));
        if (!out.includes(rule.into)) out.push(rule.into);
        changed = true;
      }
    }
  }
  return out;
}

function resolveRooms(session: SheetSession, rooms: RoomRef[]): string[] {
  if (!session.roomNames.length) {
    const fallback = FALLBACK_ROOMS[session.subject.toUpperCase()];
    return fallback && rooms.some((r) => r.id === fallback) ? [fallback] : [];
  }
  const out: string[] = [];
  for (const name of session.roomNames) {
    const id = matchRoom(name, rooms);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function matchRoom(name: string, rooms: RoomRef[]): string | null {
  const key = name.trim().toLowerCase();
  if (ROOM_ALIASES[key] && rooms.some((r) => r.id === ROOM_ALIASES[key])) return ROOM_ALIASES[key];

  // "Classroom 6", "Room 6", "C-6", a bare "6" - all the same room.
  const number = /(\d+)\s*$/.exec(key);
  if (number) {
    const byId = "c" + number[1];
    if (rooms.some((r) => r.id === byId)) return byId;
  }

  const exact = rooms.find((r) => r.name.trim().toLowerCase() === key);
  if (exact) return exact.id;

  const byId = rooms.find((r) => r.id.toLowerCase() === key.replace(/[\s-]/g, ""));
  return byId ? byId.id : null;
}

/**
 * "ADA Lab (Batch 1)" when only one batch is in it, "AP Lecture" when
 * the whole year is - the bracket is only worth the space when it
 * actually tells a student something.
 */
function buildTitle(session: SheetSession, kind: Kind, allLabels: string[]): string {
  const label = KIND_LABEL[session.kindWord.toUpperCase()] || (kind === "exam" ? "" : "Lecture");
  const base = (session.subject + " " + label).trim();
  if (session.batchLabels.length >= allLabels.length) return base;
  return base + " (" + session.batchLabels.map(tidyBatch).join(", ") + ")";
}

function tidyBatch(label: string): string {
  return label.replace(/^BATCH\s+/i, "Batch ");
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

function roomName(rooms: RoomRef[], id: string): string {
  return rooms.find((r) => r.id === id)?.name || id;
}

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function dayName(weekday: number): string {
  return DAYS[weekday] || "?";
}

function clock(minutes: number): string {
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
}
