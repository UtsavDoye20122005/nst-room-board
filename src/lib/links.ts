// ============================================================
//  Links to the seating app.
//
//  Seating lives in its own app (nst-exam-seating) because seat by
//  seat shuffling has nothing to do with rooms and bookings. This
//  file is the ONE place that knows where it is, so moving it means
//  changing one environment variable and nothing else.
//
//  The seating sheet calls a room "Classroom 6" and the board calls
//  it "C-6". The seating app squashes both to the same key, so the
//  room name can be passed across as it is.
// ============================================================

export const SEATING_URL =
  process.env.NEXT_PUBLIC_SEATING_URL || "https://nst-exam-seating.vercel.app";

/**
 * Opens the seating sheet on one room. With no room it just opens
 * the sheet. `date` only shows as a line at the top, so an
 * invigilator can see the link was meant for that exam.
 */
export function seatingLink(roomName?: string, date?: string): string {
  const base = SEATING_URL.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (roomName) params.set("room", roomName);
  if (date) params.set("date", date);
  const q = params.toString();
  return q ? base + "/?" + q : base + "/";
}
