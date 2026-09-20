// ============================================================
//  POST /api/timetable/sync
//
//  Brings the board back in line with the two Google Sheets.
//
//  Two callers:
//    - the Day Board, on every visit. Cheap by design: the sync
//      itself stops early if it checked within the last ten
//      minutes, so an ordinary morning costs one small read per
//      visitor and nothing more.
//    - Admin -> Timetable's "Sync now", which passes force and
//      skips that wait.
//
//  Security: a Firebase ID token is required, so only signed-in
//  college accounts can trigger it at all, and `force` is admin
//  only - otherwise anybody could make the site download both
//  sheets and rewrite a semester of bookings on demand.
// ============================================================

import { NextResponse } from "next/server";
import { adminAuth, adminConfigured, adminDb } from "@/lib/firebaseAdmin";
import { runTimetableSync } from "@/lib/timetable/sheetSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A first run writes a whole semester, which is thousands of small
// documents. Well inside this, but not inside the old default.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "The server is not set up to reach Firebase. Timetable sync is off." },
      { status: 503 }
    );
  }

  let body: { force?: boolean } = {};
  try {
    body = (await req.json()) as { force?: boolean };
  } catch {
    /* an empty body is fine - it means "just check" */
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let uid: string;
  try {
    uid = (await adminAuth().verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ ok: false, error: "Your session has expired. Sign in again." }, { status: 401 });
  }

  if (body.force) {
    const profile = await adminDb().collection("users").doc(uid).get();
    if (profile.data()?.role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Only an admin can force a timetable sync." },
        { status: 403 }
      );
    }
  }

  const report = await runTimetableSync({ force: Boolean(body.force) });
  return NextResponse.json(report, { status: report.ok ? 200 : 502 });
}
