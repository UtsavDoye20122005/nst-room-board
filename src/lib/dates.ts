// ============================================================
//  Date helpers. Everything is stored as "YYYY-MM-DD" in the
//  user's local time, which keeps the board free of timezone bugs.
// ============================================================

export const DOW_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const MONTH_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISO(d: Date): string {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function todayISO(): string {
  return toISO(new Date());
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** "Monday, 7 September" */
export function prettyDate(iso: string): string {
  const d = fromISO(iso);
  return DOW_LONG[d.getDay()] + ", " + d.getDate() + " " + MONTH_LONG[d.getMonth()];
}

/** "Mon 7 Sep" */
export function shortDate(iso: string): string {
  const d = fromISO(iso);
  return DOW_SHORT[d.getDay()] + " " + d.getDate() + " " + MONTH_LONG[d.getMonth()].slice(0, 3);
}

/** "Today" / "Tomorrow" / "Yesterday", else "". */
export function relativeDay(iso: string): string {
  const t = todayISO();
  if (iso === t) return "Today";
  if (iso === shiftDays(t, 1)) return "Tomorrow";
  if (iso === shiftDays(t, -1)) return "Yesterday";
  return "";
}

export function isPast(iso: string): boolean {
  return iso < todayISO();
}

/** "Monday" */
export function weekdayName(iso: string): string {
  return DOW_LONG[fromISO(iso).getDay()];
}

/** "14:05" from a millisecond timestamp. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/** Every day shown on a month grid, including the padding days. */
export function monthGrid(year: number, month: number): { iso: string; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { iso: string; inMonth: boolean }[] = [];

  for (let i = 0; i < startPad; i++) {
    const d = new Date(year, month, 1 - (startPad - i));
    cells.push({ iso: toISO(d), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: toISO(new Date(year, month, day)), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = fromISO(cells[cells.length - 1].iso);
    last.setDate(last.getDate() + 1);
    cells.push({ iso: toISO(last), inMonth: false });
  }
  return cells;
}
