// ============================================================
//  Starting data and shared constants.
//
//  The rooms and batches themselves live in
//  src/data/campusSeed.json so that `npm run seed` and the app
//  can never drift apart. Edit that file, not this one.
// ============================================================

import seed from "@/data/campusSeed.json";
import type { Batch, Room } from "./types";

export const ROOMS_SEED: Room[] = seed.rooms as Room[];
export const BATCHES_SEED: Batch[] = seed.batches as Batch[];

/** The real subject/course codes taught this term (see scripts/seedTimetable.mjs
 * for the current teacher -> subject mapping). Faculty pick from this list
 * during onboarding, so it feeds BookingModal's subject dropdown instead of
 * everyone free-typing (and mistyping) their subject by hand. */
export const SUBJECT_SUGGESTIONS: string[] = seed.subjectSuggestions;

/** Years the college runs. Add 3 and 4 here when those cohorts arrive. */
export const YEARS = [1, 2];

export function yearLabel(y: number): string {
  if (y === 1) return "1st Year";
  if (y === 2) return "2nd Year";
  if (y === 3) return "3rd Year";
  return y + "th Year";
}
