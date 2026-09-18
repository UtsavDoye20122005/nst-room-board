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

// India Standard Time is UTC+5:30 with no DST, so it's safe to hardcode
// this offset rather than depend on the server's own timezone (Vercel's
// functions run in UTC) - without this, "today"/"tomorrow" in the Slack
// message could be wrong by a day for anything booked late at night.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istTodayIso(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return ist.getUTCFullYear() + "-" + String(ist.getUTCMonth() + 1).padStart(2, "0") + "-" + String(ist.getUTCDate()).padStart(2, "0");
}

function shiftIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
}

/** "today" / "tomorrow" / "yesterday" / "on <full date>" for the Slack line. */
function dayWord(iso: string): string {
  const t = istTodayIso();
  if (iso === t) return "today";
  if (iso === shiftIso(t, 1)) return "tomorrow";
  if (iso === shiftIso(t, -1)) return "yesterday";
  return "on " + dateLabel(iso);
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        skipped: true,
        message:
          "The server is not set up yet (FIREBASE_* service-account variables are missing). Everybody can still see the change in the app.",
      },
      { status: 200 }
    );
  }

  let body: { bookingId?: string; kind?: string; reason?: string; slack?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request body." }, { status: 400 });
  }

  const { bookingId, kind, reason } = body;
  // Slack is the only channel. Nothing here mails anybody - not
  // students, not teachers. The board is where a change is seen, and
  // Slack is where it is announced.
  const slackRequested = body.slack !== false;
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

  // Slack is admin-only, even if the caller's own client asked for it.
  const wantsSlack = slackRequested && caller.role === "admin";

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

  // ---- who it concerns ----
  // Nobody is mailed. These two only label the Slack line.
  const batchIds = Array.isArray(booking.batchIds) ? booking.batchIds : [];
  const years = Array.isArray(booking.years) ? booking.years : [];

  const batchSnap = await db.collection("batches").get();
  const batches: Batch[] = batchSnap.docs
    .map((d) => ({ ...(d.data() as Batch), id: d.id }))
    .filter((b) => batchIds.includes(b.id))
    .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));

  const batchLabel = batches.length
    ? batches.map((b) => b.name).join(", ")
    : years.length
      ? years.map((y) => (y === 1 ? "1st Year" : "2nd Year")).join(" and ")
      : "All batches";

  const slack = wantsSlack
    ? await sendSlackMessage({
        kind: kind as "booked" | "cancelled" | "moved" | "reinstated",
        subject: booking.subject || "Session",
        title: booking.title || "",
        facultyName: booking.facultyName || caller.name,
        roomName: room?.name || booking.roomId,
        previousRoomName,
        dayWord: dayWord(booking.date),
        timeLabel: timeLabel(booking.startSlot, booking.endSlot),
        batchLabel,
        years,
        reason: reason || booking.cancelReason || "",
      })
    : { attempted: false, ok: false, error: undefined as string | undefined };

  const slackState =
    slackRequested && caller.role !== "admin"
      ? "admin only"
      : !wantsSlack
        ? "skipped"
        : !slack.attempted
          ? "not configured"
          : slack.ok
            ? "posted"
            : "failed: " + slack.error;

  return NextResponse.json({
    ok: !slackState.startsWith("failed"),
    batchLabel,
    slack: slackState,
    message:
      slackState === "posted"
        ? "Posted to Slack."
        : slackState === "admin only"
          ? "Only an admin can post to Slack. The change is on the board for everybody."
          : slackState === "not configured"
            ? "Slack is not set up, so nothing was posted. The change is on the board for everybody."
            : slackState === "skipped"
              ? "The change is on the board for everybody."
              : "Slack " + slackState + ". The change is still on the board for everybody.",
  });
}
