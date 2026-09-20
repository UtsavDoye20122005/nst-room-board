// ============================================================
//  WHICH SHEETS, AND HOW THEY MAP ONTO THIS CAMPUS.
//
//  This is the file to edit when the timetable moves to a new
//  spreadsheet, a room gets renamed, or a teacher's name needs
//  fixing. Nothing else should need touching.
//
//  The sheets themselves stay the source of truth for WHAT is
//  taught, WHEN and WHERE. All this file does is translate the
//  words on them into the ids this app already uses.
// ============================================================

import type { Kind } from "../types";

export interface SheetSource {
  /** The id out of the sheet's own URL. */
  id: string;
  /** Shown in the sync report and on Admin -> Timetable. */
  label: string;
  /** Year every session on this sheet belongs to. */
  year: number;
  /** "BATCH A1" etc. as written on the sheet -> a batch id here. */
  batches: Record<string, string>;
}

/**
 * Both sheets are shared as "anyone with the link can view", which
 * is all the zip export needs - no API key, no service account, and
 * nothing to switch on inside Google. If a sheet is ever set back to
 * private the sync will say so rather than quietly going stale.
 */
export const SHEETS: SheetSource[] = [
  {
    id: "1N5-MVGIZR2EruBgZ0DSY9ZpR3VhW3OYZ1OCtdXJX7rQ",
    label: "1st Year, 1st Sem",
    year: 1,
    batches: {
      "BATCH A1": "y1-lab-a1",
      "BATCH A2": "y1-lab-a2",
      "BATCH B1": "y1-lab-b1",
      "BATCH B2": "y1-lab-b2",
    },
  },
  {
    id: "1vcX7VPLyVBrXB1wL1MoNp6OW-5xXRP-Bmq7ndm5jpJw",
    label: "2nd Year, 3rd Sem",
    year: 2,
    batches: {
      "BATCH 1": "y2-a",
      "BATCH 2": "y2-b",
    },
  },
];

/**
 * A session the sheet merges across BOTH halves of a year group is a
 * session for the whole group, so it is booked against the batch that
 * actually has the roster on it rather than against two lab groups
 * that nobody is enrolled in yet.
 *
 * This is read off the sheet's own merged cells, not guessed: the 1st
 * Year sheet draws a lecture for A1 and A2 as one tall cell spanning
 * both rows, and a lab that genuinely splits them as two short ones.
 */
export const BATCH_MERGES: { parts: string[]; into: string }[] = [
  { parts: ["y1-lab-a1", "y1-lab-a2"], into: "y1-a" },
  { parts: ["y1-lab-b1", "y1-lab-b2"], into: "y1-b" },
];

/**
 * Room names as the sheets write them -> room ids in `rooms`.
 * "Classroom 6" is matched by the number, so "Classroom 6",
 * "CLASSROOM 6" and a bare "6" in a comma list all land on C-6.
 * Anything not matched here is looked up against the real room names
 * in Firestore before being reported as unknown.
 */
export const ROOM_ALIASES: Record<string, string> = {
  "concept room": "concept",
  "concept": "concept",
  "pizza room": "concept",
  "basement": "basement",
  "arvr zone": "arvr",
  "robo lab": "robolab",
};

/**
 * Where a session goes when the sheet names no room at all.
 *
 * Both current cases are practicals - "YOGA PRACTICAL" and "HOLISTIC
 * PRACTICAL" are written with no room beside them. Yoga is in the
 * basement (confirmed). A session whose subject is not listed here is
 * NOT guessed at: it is skipped and reported, because putting a class
 * in the wrong room is worse than admitting we do not know.
 */
export const FALLBACK_ROOMS: Record<string, string> = {
  YOGA: "basement",
  HOLISTIC: "concept",
};

/** What the sheet's LEC/LAB/PRACTICAL wording means to this app. */
export function kindFrom(kindWord: string, subject: string): Kind {
  if (subject.toUpperCase() === "CONTEST") return "exam";
  switch (kindWord.toUpperCase()) {
    case "LAB":
    case "PRACTICAL":
      return "lab";
    case "LEC":
    case "LECTURE":
    case "CLASS":
    case "TUT":
    case "TUTORIAL":
      return "class";
    default:
      return "class";
  }
}

export interface SheetTeacher {
  name: string;
  uid: string;
}

/**
 * Who teaches what. The sheets carry no names at all, so this is the
 * one piece of the timetable that does NOT come from them.
 *
 * Keys are "SUBJECT" or "SUBJECT:LAB" - a lecture and its lab are
 * often different people. Names carry "Sir"/"Mam" because that is how
 * they are shown everywhere in the app.
 *
 * The uid is a label, not a login. These teachers still sign in and
 * onboard normally; this is only what the board prints under a class.
 */
export const TEACHERS: Record<string, SheetTeacher> = {
  AP: { name: "Pranav Sir", uid: "sheet-teacher-ap" },
  "AP:LAB": { name: "Pranav Sir & Shubham Sir", uid: "sheet-teacher-ap-lab" },
  ADA: { name: "Ashwin Sir", uid: "sheet-teacher-ada" },
  "ADA:LAB": { name: "Goutam Sir", uid: "sheet-teacher-ada-lab" },
  AI: { name: "Mahfooj Sir", uid: "sheet-teacher-ai" },
  DE: { name: "Adarsh Chauhan Sir", uid: "sheet-teacher-de" },
  M3: { name: "Adhiraj Sir", uid: "sheet-teacher-m3" },
  "M3:LAB": { name: "Anupam Sir", uid: "sheet-teacher-m3-lab" },
  HOLISTIC: { name: "Soumya Mam", uid: "sheet-teacher-holistic" },
  CONTEST: { name: "Exam Cell", uid: "sheet-exam-cell" },
};

/**
 * Used for every 1st Year subject, whose teachers we have not been
 * given yet. Deliberately not a guess at a real name - add the real
 * ones to TEACHERS above and the next sync corrects every session.
 */
export const TEACHER_UNKNOWN: SheetTeacher = { name: "Faculty TBD", uid: "sheet-teacher-tbd" };

export function teacherFor(subject: string, kind: Kind): SheetTeacher {
  const key = subject.toUpperCase();
  if (kind === "lab" && TEACHERS[key + ":LAB"]) return TEACHERS[key + ":LAB"];
  return TEACHERS[key] || TEACHER_UNKNOWN;
}

/** How many weeks ahead the sheet is booked out. */
export const HORIZON_WEEKS = 15;

/**
 * How long a sync result is treated as fresh. The board pings the
 * sync endpoint whenever somebody opens it; within this window that
 * ping costs one small read and nothing else, so a busy morning does
 * not mean a download per visitor.
 */
export const FRESH_FOR_MS = 10 * 60 * 1000;

/** Where the sync's own state lives. Readable by anyone signed in. */
export const SYNC_DOC = "timetableSync";
