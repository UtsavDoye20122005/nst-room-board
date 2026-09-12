// ============================================================
//  POST /api/notify
//
//  Called by the app right after a booking is created, moved,
//  cancelled or reinstated. It works out who needs to know,
//  and emails them.
//
//  Security: the caller must send a Firebase ID token. The token
//  is verified server side, and only faculty or admins may fire
//  a notification. The client never sees the email credentials.
// ============================================================

import { NextResponse } from "next/server";
import { adminAuth, adminConfigured, adminDb } from "@/lib/firebaseAdmin";
import { buildEmail, sendEmail } from "@/lib/email";
import { sendSlackMessage } from "@/lib/slack";
import { SLOTS } from "@/lib/slots";
import type { Batch, Booking, Room, UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return DOW[dt.getDay()] + ", " + d + " " + MONTHS[m - 1] + " " + y;
}

/**
 * A booking created as part of a weekly series (seriesUntil is set)
 * reads as "Every Monday, from 7 Sep 2026 to 21 Dec 2026" instead of
 * a single date - this is the email for the first week, so a single
 * date would be misleading about what was actually booked.
 */
function dateLabelForBooking(booking: Booking): string {
  if (!booking.seriesUntil) return dateLabel(booking.date);
  const [y, m, d] = booking.date.split("-").map(Number);
  const weekday = DOW[new Date(y, m - 1, d).getDay()];
  return "Every " + weekday + ", from " + dateLabel(booking.date) + " to " + dateLabel(booking.seriesUntil);
}

function timeLabel(startSlot: number, endSlot: number): string {
  const a = SLOTS[startSlot];
  const b = SLOTS[endSlot];
  if (!a || !b) return "--";
  return a.start + " to " + b.end;
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        skipped: true,
        message:
          "Email is not set up on the server yet (FIREBASE_* service-account variables are missing). Students can still see the change in the app.",
      },
      { status: 200 }
    );
  }

  let body: { bookingId?: string; kind?: string; reason?: string; email?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request body." }, { status: 400 });
  }

  const { bookingId, kind, reason } = body;
  // Slack always fires below, regardless of this - it's the "no risk" channel.
  // Real email only goes out when the caller explicitly asks for it (the
  // "Email the selected batches now" / "Email ... about the change" checkboxes
  // in the app). Omitting this field defaults to true, so older clients that
  // don't send it yet keep their existing behaviour.
  const wantsEmail = body.email !== false;
  const validKinds = ["booked", "cancelled", "moved", "reinstated"];
  if (!bookingId || !kind || !validKinds.includes(kind)) {
    return NextResponse.json({ ok: false, message: "bookingId and a valid kind are required." }, { status: 400 });
  }

  // ---- who is asking ----
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return NextResponse.json({ ok: false, message: "Missing sign-in token." }, { status: 401 });
  }

  let callerUid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, message: "Your session expired. Reload and sign in again." }, { status: 401 });
  }

  const db = adminDb();

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as UserProfile | undefined;
  if (!caller || (caller.role !== "faculty" && caller.role !== "admin")) {
    return NextResponse.json({ ok: false, message: "Only faculty can send notifications." }, { status: 403 });
  }

  // ---- what changed ----
  const bookingSnap = await db.collection("bookings").doc(bookingId).get();
  if (!bookingSnap.exists) {
    return NextResponse.json({ ok: false, message: "That booking no longer exists." }, { status: 404 });
  }
  const booking = { ...(bookingSnap.data() as Booking), id: bookingSnap.id };

  const roomSnap = await db.collection("rooms").doc(booking.roomId).get();
  const room = roomSnap.exists ? (roomSnap.data() as Room) : null;

  let previousRoomName = "";
  if (booking.movedFrom) {
    const prev = await db.collection("rooms").doc(booking.movedFrom).get();
    previousRoomName = prev.exists ? (prev.data() as Room).name : booking.movedFrom;
  }

  // ---- who to tell ----
  // Students are never emailed - they hear about room/time changes on
  // Slack instead. This goes to staff only (faculty + admin), so the
  // rest of the team knows what changed. `batchIds`/`years` are only
  // used below to build the informational "Batches:" line in the
  // email itself, not to pick recipients anymore.
  const batchIds = Array.isArray(booking.batchIds) ? booking.batchIds : [];
  const years = Array.isArray(booking.years) ? booking.years : [];

  const batchSnap = await db.collection("batches").get();
  const batches: Batch[] = batchSnap.docs
    .map((d) => ({ ...(d.data() as Batch), id: d.id }))
    .filter((b) => batchIds.includes(b.id))
    .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));

  const recipients = new Set<string>();
  const staffSnap = await db.collection("users").where("role", "in", ["faculty", "admin"]).get();

  for (const d of staffSnap.docs) {
    const u = d.data() as UserProfile;
    if (u.email) recipients.add(u.email);
  }

  const batchLabel = batches.length
    ? batches.map((b) => b.name).join(", ")
    : years.length
      ? years.map((y) => (y === 1 ? "1st Year" : "2nd Year")).join(" and ")
      : "All batches";

  const mail = buildEmail({
    kind: kind as "booked" | "cancelled" | "moved" | "reinstated",
    subject: booking.subject || "Session",
    title: booking.title || "",
    facultyName: booking.facultyName || caller.name,
    roomName: room?.name || booking.roomId,
    roomNote: room?.note || "",
    previousRoomName,
    dateLabel: dateLabelForBooking(booking),
    timeLabel: timeLabel(booking.startSlot, booking.endSlot),
    batchLabel,
    note: booking.note || "",
    reason: reason || booking.cancelReason || "",
  });

  const [result, slack] = await Promise.all([
    wantsEmail
      ? sendEmail({ ...mail, bcc: Array.from(recipients) })
      : Promise.resolve({ provider: "skipped", attempted: 0, sent: 0, failed: 0, errors: [] as string[] }),
    sendSlackMessage({
      kind: kind as "booked" | "cancelled" | "moved" | "reinstated",
      subject: booking.subject || "Session",
      title: booking.title || "",
      facultyName: booking.facultyName || caller.name,
      roomName: room?.name || booking.roomId,
      previousRoomName,
      dateLabel: dateLabelForBooking(booking),
      timeLabel: timeLabel(booking.startSlot, booking.endSlot),
      batchLabel,
      reason: reason || booking.cancelReason || "",
    }),
  ]);

  return NextResponse.json({
    ok: result.failed === 0,
    provider: result.provider,
    attempted: result.attempted,
    sent: result.sent,
    failed: result.failed,
    errors: result.errors,
    batchLabel,
    slack: !slack.attempted ? "not configured" : slack.ok ? "posted" : "failed: " + slack.error,
    message:
      !wantsEmail
        ? "Slack notified" + (slack.attempted && !slack.ok ? " (though Slack itself failed: " + slack.error + ")" : "") + ". Email was skipped for this update."
        : result.attempted === 0
          ? "Nobody to email yet — staff appear here once they have signed in to the board at least once."
          : result.provider === "console"
            ? "Email is in test mode (EMAIL_PROVIDER=console), so nothing was actually sent. " + result.attempted + " staff member(s) would have been mailed."
            : result.failed === 0
              ? "Emailed " + result.sent + " staff member(s)."
              : "Emailed " + result.sent + ", failed for " + result.failed + ".",
  });
}
