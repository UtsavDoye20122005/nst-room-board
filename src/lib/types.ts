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
  /**
   * Admin sign-off. A teacher's own booking lands as `false` and shows
   * on the board as awaiting approval - the room IS still held for
   * them meanwhile, so nobody else can take the slot while an admin
   * decides. An admin's own booking is `true` immediately.
   *
   * Undefined counts as approved: every booking made before this field
   * existed (and every seeded timetable row) is already legitimate, and
   * must not suddenly read as "pending" on the board.
   */
  approved?: boolean;
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

// ------------------------------------------------------------
//  Invigilation
// ------------------------------------------------------------

/**
 * A teacher who can be given exam duty. Document id is their email
 * in lower case, so a duty can be written before that person has
 * ever signed in - the duty finds them the moment they do.
 *
 * `duties` and `skips` are running counters. They are what makes the
 * draw fair: fewer past duties means a better chance of being picked.
 */
export interface Invigilator {
  email: string;
  name: string;
  active: boolean;
  duties: number;
  skips: number;
  lastDutyDate?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One room on an exam day, and how many invigilators it needs. */
export interface ExamRoomPlan {
  roomId: string;
  roomName: string;
  capacity: number;
  needed: number;
  /** Unticked rooms are not used for this exam. */
  used: boolean;
}

export type ExamDayStatus = "draft" | "published";

/** One exam sitting: a date, a time, and the rooms being used. */
export interface ExamDay {
  /** The date, which is also the document id - one sitting per day. */
  id: string;
  date: string;
  title: string;
  startSlot: number;
  endSlot: number;
  rooms: ExamRoomPlan[];
  /** Emails of the teachers drawn as standby. */
  reserves: string[];
  reserveCount: number;
  status: ExamDayStatus;
  createdAt: number;
  updatedAt: number;
}

export type DutyStatus = "assigned" | "skip-requested" | "skipped";

/**
 * One teacher's duty on one exam day. Document id is
 * `<date>__<email>`, so a teacher can never be drawn twice for the
 * same sitting, whatever else goes wrong.
 */
export interface Duty {
  id: string;
  date: string;
  email: string;
  name: string;
  roomId: string;
  roomName: string;
  startSlot: number;
  endSlot: number;
  status: DutyStatus;
  skipReason: string;
  skipAt: number | null;
  /** Email of the colleague this teacher asked to sit with. */
  partnerRequestTo: string | null;
  partnerRequestAt: number | null;
  /**
   * Set on BOTH teachers once a partner request is accepted. A fixed
   * pair cannot be changed from a teacher's own page - only the exam
   * office can undo it, from Exams.
   */
  partnerLocked?: boolean;
  partnerName?: string | null;
  /**
   * The other half of the pair, by address. A name is not an identity
   * - two rooms can hold two people with the same name - and without
   * this the lock can only be cleared on one side.
   */
  partnerEmail?: string | null;
  /**
   * "no" means this teacher was asked whether they wanted the same
   * partner as last time and said no, so the question stops coming
   * back and they get the list of everybody free instead. Every fresh
   * draw clears it, because each exam deserves its own answer.
   */
  pairAgain?: "no" | null;
  /**
   * Who this teacher was fixed with last time round, stamped on when
   * the duty is drawn. Stored rather than worked out later, so the
   * question still gets asked after the old exam day has been deleted
   * or redrawn - which is exactly when it is most wanted.
   */
  lastPartnerEmail?: string | null;
  lastPartnerName?: string | null;
  lastPartnerDate?: string | null;
  /**
   * A teacher asking for somebody who is NOT on duty that day, in
   * place of the colleague they were drawn with. Swapping a colleague
   * out is the exam office's call, so this sits here until an admin
   * approves or refuses it.
   */
  swapWantEmail?: string | null;
  swapWantName?: string | null;
  swapOutEmail?: string | null;
  swapOutName?: string | null;
  swapAt?: number | null;
  /**
   * When this exam starts, in milliseconds. Written at draw time so the
   * attendance window can be checked by the security rules, which
   * cannot work it out from a date string and a slot number.
   */
  startsAt?: number | null;
  /** null = not marked yet. */
  present: boolean | null;
  markedAt: number | null;
  markedBy: string | null;
  assignedAt: number;
  updatedAt: number;
}

/** Admin-only trail of everything that happened to the duties. */
export interface InvigLogEntry {
  id: string;
  ts: number;
  action: string;
  text: string;
  date: string;
  byEmail: string;
  byName: string;
}
