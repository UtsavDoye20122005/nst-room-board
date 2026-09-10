// ============================================================
//  The teaching day.
//
//  TO CHANGE THE TIMETABLE: edit this one array. The board, the
//  booking form, the calendar and the emails all read from it,
//  so nothing else needs touching.
// ============================================================

export interface Slot {
  index: number;
  start: string;
  end: string;
  /** Shown greyed on the board; still bookable if you need it. */
  isBreak?: boolean;
}

// Half-hour grid, 9:00 to 22:00 - matches the real timetable your college
// gave us (classes run 9:30-11:00, labs run in odd 90-minute blocks) and
// extends into the evening for extra sessions, practice slots and events
// that run after the regular day. An hourly grid couldn't represent the
// class pattern; this can.
export const SLOTS: Slot[] = [
  { index: 0, start: "09:00", end: "09:30" },
  { index: 1, start: "09:30", end: "10:00" },
  { index: 2, start: "10:00", end: "10:30" },
  { index: 3, start: "10:30", end: "11:00" },
  { index: 4, start: "11:00", end: "11:30" },
  { index: 5, start: "11:30", end: "12:00" },
  // Lunch runs 12:30-2:00 most days, 12:00-1:30 on Friday - these four
  // slots cover both. Any of them a real class actually uses (e.g. an
  // 11:00 lecture running into 12:00, or Friday's 1:30 lecture inside
  // 13:30-14:00) still shows that class - a real booking always wins
  // over the lunch label, this only affects genuinely free hours.
  { index: 6, start: "12:00", end: "12:30", isBreak: true },
  { index: 7, start: "12:30", end: "13:00", isBreak: true },
  { index: 8, start: "13:00", end: "13:30", isBreak: true },
  { index: 9, start: "13:30", end: "14:00", isBreak: true },
  { index: 10, start: "14:00", end: "14:30" },
  { index: 11, start: "14:30", end: "15:00" },
  { index: 12, start: "15:00", end: "15:30" },
  { index: 13, start: "15:30", end: "16:00" },
  { index: 14, start: "16:00", end: "16:30" },
  { index: 15, start: "16:30", end: "17:00" },
  { index: 16, start: "17:00", end: "17:30" },
  { index: 17, start: "17:30", end: "18:00" },
  { index: 18, start: "18:00", end: "18:30" },
  { index: 19, start: "18:30", end: "19:00" },
  { index: 20, start: "19:00", end: "19:30" },
  { index: 21, start: "19:30", end: "20:00" },
  { index: 22, start: "20:00", end: "20:30" },
  { index: 23, start: "20:30", end: "21:00" },
  { index: 24, start: "21:00", end: "21:30" },
  { index: 25, start: "21:30", end: "22:00" },
];

export const FIRST_SLOT = 0;
export const LAST_SLOT = SLOTS.length - 1;

export function slotRange(startSlot: number, endSlot: number): string {
  const a = SLOTS[startSlot];
  const b = SLOTS[endSlot];
  if (!a || !b) return "--";
  return a.start + "–" + b.end;
}

/**
 * Real duration in hours between two slots (inclusive) - e.g. 1.5 for
 * a 90-minute session. Each slot is 30 minutes, so this is NOT the
 * same as the slot count (endSlot - startSlot + 1); that was true back
 * when SLOTS was hourly, but the half-hour grid above means a 3-slot
 * lab is 1.5 hours, not 3.
 */
export function slotHours(startSlot: number, endSlot: number): number {
  return (endSlot - startSlot + 1) * 0.5;
}

/** Human label for that duration - "30 min", "1 hr", "1 hr 30 min", "2 hrs". */
export function formatDuration(startSlot: number, endSlot: number): string {
  const totalMinutes = (endSlot - startSlot + 1) * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return m + " min";
  if (m === 0) return h + (h === 1 ? " hr" : " hrs");
  return h + (h === 1 ? " hr " : " hrs ") + m + " min";
}

/** Index of the slot the wall clock is inside right now, or -1. */
export function currentSlotIndex(now = new Date()): number {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const s of SLOTS) {
    const [h1, m1] = s.start.split(":").map(Number);
    const [h2, m2] = s.end.split(":").map(Number);
    if (mins >= h1 * 60 + m1 && mins < h2 * 60 + m2) return s.index;
  }
  return -1;
}
