"use client";

// ============================================================
//  Client-side helper that asks the server to send the emails.
//
//  Deliberately forgiving: if the notification fails, the booking
//  change has ALREADY happened and is visible in the app. We report
//  the problem to the teacher rather than pretending the whole
//  action failed.
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
  reason?: string
): Promise<NotifyResult> {
  try {
    const user = getFirebaseAuth().currentUser;
    if (!user) return { ok: false, message: "Not signed in, so no email was sent." };

    const token = await user.getIdToken();
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ bookingId, kind, reason: reason || "" }),
    });

    const data = (await res.json()) as NotifyResult;
    return { ok: Boolean(data.ok), message: data.message || "Notification handled.", sent: data.sent, attempted: data.attempted, provider: data.provider };
  } catch (e) {
    return { ok: false, message: "Could not reach the email service: " + (e instanceof Error ? e.message : String(e)) };
  }
}
