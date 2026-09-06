// ============================================================
//  Every shape the app stores in Firestore lives here.
//  Change a field name here and TypeScript will point you at
//  every place that needs updating.
// ============================================================

export type Role = "faculty" | "student" | "admin";
export type Kind = "exam" | "class" | "lab" | "event";
export type Status = "confirmed" | "cancelled";

/** A signed-in person. Document id is the Firebase Auth uid. */
export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: Role;
  /** Faculty only: subjects this teacher takes, e.g. ["Robotics"]. */
  subjects: string[];
  /** Faculty only: which years they teach, e.g. [1, 2]. */
  years: number[];
  /** Student only. */
  year?: number;
  batchId?: string;
  createdAt: number;
  updatedAt: number;
}

/** A bookable space. Document id is the room id, e.g. "c6". */
export interface Room {
  id: string;
  name: string;
  /** Nickname or extra description, e.g. "Pizza Classroom". */
  note: string;
  capacity: number;
  /** Left-to-right order on the board. */
  order: number;
  active: boolean;
}

/** A student group. Document id is the batch id, e.g. "y2-a". */
export interface Batch {
  id: string;
  name: string;
  year: number;
  strength: number;
  /** Extra addresses to copy on notices (guest students, coordinators). */
  extraEmails: string[];
}

/**
 * One pre-loaded roster row, keyed by student email (document id).
 * Lets onboarding recognise a student BEFORE they ever sign in - their
 * year and batch are already known, so instead of asking them to pick,
 * the form just confirms it. `name` is filled in once the real roster
 * names are loaded (npm run seed-roster); until then it's blank and
 * the student still types their own name.
 */
export interface RosterEntry {
  email: string;
  name: string;
  year: number;
  batchId: string;
}

/** One booked session. Can span several consecutive hours. */
export interface Booking {
  id: string;
  /** YYYY-MM-DD in local time. */
  date: string;
  roomId: string;
  startSlot: number;
  endSlot: number;
  kind: Kind;
  /** The subject, e.g. "Robotics". Pre-filled from the teacher's profile. */
  subject: string;
  /** Short description shown on the board, e.g. "Line-follower demo". */
  title: string;
  facultyUid: string;
  facultyName: string;
  /** Years invited: [1], [2] or [1, 2]. */
  years: number[];
  batchIds: string[];
  /** Longer note for students. */
  note: string;
  status: Status;
  cancelReason?: string;
  /** Room id this session was moved away from, if any. */
  movedFrom?: string | null;
  /**
   * Set when this occurrence was created as part of a weekly series
   * (a timetable slot booked once a week for a whole semester).
   * seriesId is the Firestore id of the FIRST occurrence created -
   * every other week in the series carries the same value, so "cancel
   * this and every future week" can find them all with one query.
   * seriesUntil is the last date the series was booked through.
   */
  seriesId?: string | null;
  seriesUntil?: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * One document per occupied hour. Its id is deterministic:
 *   <date>_<roomId>_<slot>
 * Because two teachers booking the same hour would be creating the
 * SAME document id, a Firestore transaction can guarantee only one
 * of them wins. This is what makes double booking impossible.
 */
export interface SlotLock {
  bookingId: string;
  date: string;
  roomId: string;
  slot: number;
  facultyUid: string;
  facultyName: string;
  title: string;
  subject: string;
}

export type NoticeKind = "booked" | "cancelled" | "moved" | "reinstated";

export interface Notice {
  id: string;
  kind: NoticeKind;
  text: string;
  bookingId: string;
  batchIds: string[];
  years: number[];
  byUid: string;
  byName: string;
  createdAt: number;
  /** Set by /api/notify once mail has gone out. */
  emailedTo?: number;
}
