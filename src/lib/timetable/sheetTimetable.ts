// ============================================================
//  Giving the grid its meaning.
//
//  sheetGrid.ts hands us a rectangle of text. This file reads it
//  as a timetable: which day, which hours, which batches, which
//  room. It still knows nothing about Firestore or about this
//  app's room ids - that mapping is sheetSync.ts's job - so the
//  whole thing is a pure function of the sheet, and can be run
//  against a downloaded sheet to see exactly what the site is
//  about to be told.
//
//  The shape both sheets share:
//
//      MONDAY        9:00-9.15  9:15-9.30  9:30-10:00  ...
//      2nd Year 3rd Sem
//      BATCH 1                  [ AP LEC- Classroom 6 ][ ADA ...
//      BATCH 2                  [ ADA LAB - Concept Room  ][ ...
//      (blank row)
//      TUESDAY       ...
//
//  A day header, a row of time columns (on the SAME row as the
//  day name in the 1st Year sheet, on the next row in the 2nd
//  Year one - both are handled), then one row per batch, then a
//  blank row before the next day.
//
//  A cell merged downwards across several batch rows is a session
//  those batches sit in TOGETHER. That is how the 1st Year sheet
//  says a lecture is for all of Batch A rather than for A1 or A2
//  alone, and it is read here rather than hardcoded.
// ============================================================

import { parseTable, type GridCell } from "./sheetGrid";

export interface SheetSession {
  /** 1 = Monday ... 7 = Sunday, matching Date.getDay() with Sunday as 0/7. */
  weekday: number;
  /** Minutes since midnight, e.g. 570 for 09:30. */
  startMinutes: number;
  endMinutes: number;
  /** "AP", "S&AI", "CONTEST"... */
  subject: string;
  /** "LEC" | "LAB" | "PRACTICAL" | "" - as written on the sheet. */
  kindWord: string;
  /** Room names exactly as the sheet writes them; CONTEST names five. */
  roomNames: string[];
  /** "BATCH A1", "BATCH 1"... every batch row this cell spans. */
  batchLabels: string[];
  /** The cell's own text, kept for notes and for error messages. */
  raw: string;
}

export interface ParsedSheet {
  sessions: SheetSession[];
  /** Anything skipped or not understood, in plain English. */
  warnings: string[];
}

const WEEKDAYS: Record<string, number> = {
  MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7,
};

/** Cells that mark time off rather than book a room. */
const NOT_A_SESSION = /^(LUNCH|BREAK|RECESS|FREE|-+)$/i;

/** Words a subject may end with that say what KIND of session it is. */
const KIND_WORDS = new Set(["LEC", "LECTURE", "LAB", "PRACTICAL", "TUT", "TUTORIAL", "CLASS"]);

const TIME_RANGE = /^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/;

export function parseSheet(html: string): ParsedSheet {
  return readGrid(parseTable(html));
}

export function readGrid(cells: GridCell[]): ParsedSheet {
  const warnings: string[] = [];
  const sessions: SheetSession[] = [];

  const byRow = new Map<number, GridCell[]>();
  for (const c of cells) {
    const list = byRow.get(c.row);
    if (list) list.push(c);
    else byRow.set(c.row, [c]);
  }
  const rowNumbers = [...byRow.keys()].sort((a, b) => a - b);

  /** row -> the batch label that row belongs to. */
  const batchRow = new Map<number, string>();
  /** row -> the day and time columns in force for it. */
  const context = new Map<number, { weekday: number; dayName: string; columns: TimeColumn[] }>();

  let weekday = 0;
  let dayName = "";
  let columns: TimeColumn[] = [];

  for (const r of rowNumbers) {
    const row = byRow.get(r)!;
    const first = row.find((c) => c.col === 0);
    const label = (first?.text || "").trim();
    const upper = label.toUpperCase();

    if (upper in WEEKDAYS) {
      weekday = WEEKDAYS[upper];
      dayName = label;
      // The 1st Year sheet puts the day name and the time columns on
      // one row; the 2nd Year sheet puts the times on the row below.
      // Reading times off ANY row that has them covers both without
      // having to know which sheet this is.
      columns = [];
    }

    const times = readTimeColumns(row);
    if (times.length) {
      columns = times;
      continue; // a header row is never also a batch row
    }

    if (/^BATCH\b/i.test(label)) {
      if (!weekday) {
        warnings.push('Found "' + label + '" before any day name - skipped.');
        continue;
      }
      if (!columns.length) {
        warnings.push('No time columns found for ' + (dayName || "that day") + ' - "' + label + '" skipped.');
        continue;
      }
      batchRow.set(r, label);
      context.set(r, { weekday, dayName, columns });
    }
  }

  for (const cell of cells) {
    if (cell.col === 0) continue;
    const ctx = context.get(cell.row);
    if (!ctx) continue; // header, blank or year-label row
    const text = cell.text.trim();
    if (!text || NOT_A_SESSION.test(text)) continue;

    const startCol = ctx.columns.find((c) => c.col === cell.col);
    const endCol = ctx.columns.find((c) => c.col === cell.col + cell.colSpan - 1);
    if (!startCol || !endCol) {
      warnings.push(
        ctx.dayName + ': "' + text + '" sits outside the timed columns - skipped.'
      );
      continue;
    }

    // A cell merged downwards belongs to every batch row it covers.
    const batchLabels: string[] = [];
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      const b = batchRow.get(r);
      if (b) batchLabels.push(b);
    }
    if (!batchLabels.length) continue;

    const { subject, kindWord, roomNames } = splitCell(text);
    sessions.push({
      weekday: ctx.weekday,
      startMinutes: startCol.start,
      endMinutes: endCol.end,
      subject,
      kindWord,
      roomNames,
      batchLabels,
      raw: text,
    });
  }

  return { sessions, warnings };
}

// ------------------------------------------------------------
//  Time columns
// ------------------------------------------------------------

interface TimeColumn {
  col: number;
  start: number;
  end: number;
}

/**
 * Reads a row's "9:30-10:00" headers into minutes.
 *
 * The sheet writes the afternoon in 12-hour form with no am/pm -
 * "1:30-2:00" is half past one, not half past one in the morning -
 * so anything before 8 is read as afternoon. The columns are also
 * NOT all the same width (the day opens with two 15-minute columns,
 * and lunch is a single one-hour column), which is exactly why each
 * column carries its own start and end rather than an index into a
 * fixed grid.
 */
function readTimeColumns(row: GridCell[]): TimeColumn[] {
  const out: TimeColumn[] = [];
  let previousEnd = -1;
  for (const cell of [...row].sort((a, b) => a.col - b.col)) {
    if (cell.col === 0) continue;
    const m = TIME_RANGE.exec(cell.text.replace(/\s/g, ""));
    if (!m) continue;
    let start = toMinutes(Number(m[1]), Number(m[2]));
    let end = toMinutes(Number(m[3]), Number(m[4]));
    // The day only ever runs forwards. If a column looks like it goes
    // backwards, the 12-hour reading was the wrong one.
    if (end <= start) end += 12 * 60;
    while (start < previousEnd) {
      start += 12 * 60;
      end += 12 * 60;
    }
    previousEnd = end;
    out.push({ col: cell.col, start, end });
  }
  return out.length >= 3 ? out : [];
}

function toMinutes(hour: number, minute: number): number {
  const h = hour < 8 ? hour + 12 : hour;
  return h * 60 + minute;
}

// ------------------------------------------------------------
//  Cell text
// ------------------------------------------------------------

/**
 * "S&AI LEC- Classroom 8"  ->  S&AI, LEC, ["Classroom 8"]
 * "YOGA PRACTICAL"         ->  YOGA, PRACTICAL, []
 * "CONTEST - Classroom 1,4,6,8,Concept Room"
 *                          ->  CONTEST, "", five room names
 *
 * Split on the FIRST dash: no subject on either sheet contains one,
 * and the room half can ("Classroom 1,4,6,8" aside, a room could be
 * called anything). Bare numbers in a room list inherit the word in
 * front of them, so "Classroom 1,4,6,8" is four classrooms and not
 * one classroom and three mystery rooms.
 */
export function splitCell(text: string): { subject: string; kindWord: string; roomNames: string[] } {
  const dash = text.search(/[-–—]/);
  const left = (dash >= 0 ? text.slice(0, dash) : text).trim();
  const right = (dash >= 0 ? text.slice(dash + 1) : "").trim();

  const words = left.split(/\s+/).filter(Boolean);
  let kindWord = "";
  if (words.length > 1 && KIND_WORDS.has(words[words.length - 1].toUpperCase())) {
    kindWord = words.pop()!.toUpperCase();
  }
  const subject = words.join(" ").trim();

  return { subject, kindWord, roomNames: splitRooms(right) };
}

function splitRooms(right: string): string[] {
  if (!right) return [];
  const parts = right.split(",").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let lastWord = "";
  for (const part of parts) {
    if (/^\d+$/.test(part) && lastWord) out.push(lastWord + " " + part);
    else {
      const m = /^(.*?)\s*\d+$/.exec(part);
      if (m && m[1]) lastWord = m[1];
      out.push(part);
    }
  }
  return out;
}
