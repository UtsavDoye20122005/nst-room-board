"use client";

// ============================================================
//  Client-side helper that asks the server to announce a change.
//
//  Slack only - nothing here mails anybody. Deliberately forgiving:
//  if the announcement fails, the booking change has ALREADY happened
//  and is on the board. We report the problem to the teacher rather
//  than pretending the whole action failed.
// ============================================================

import { getFirebaseAuth } from "./firebase";

export interface NotifyResult {
  ok: boolean;
  message: string;
  sent?: number;
  attempted?: number;
  provider?: string;
}

export async function notifyStudents(
  bookingId: string,
  kind: "booked" | "cancelled" | "moved" | "reinstated",
  reason?: string,
  /** Posting to Slack is its own opt-in, driven by a checkbox in the app. */
  slack: boolean = true
): Promise<NotifyResult> {
  try {
    const user = getFirebaseAuth().currentUser;
    if (!user) return { ok: false, message: "Not signed in, so nothing was announced." };

    const token = await user.getIdToken();
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ bookingId, kind, reason: reason || "", slack }),
    });

    const data = (await res.json()) as NotifyResult;
    return { ok: Boolean(data.ok), message: data.message || "Notification handled.", sent: data.sent, attempted: data.attempted, provider: data.provider };
  } catch (e) {
    return { ok: false, message: "Could not reach the server: " + (e instanceof Error ? e.message : String(e)) };
  }
}
