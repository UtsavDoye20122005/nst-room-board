"use client";

// ============================================================
//  The client half of "the board follows the sheets".
//
//  Opening the Day Board asks the server to re-check the Google
//  Sheets. The server does nothing if it already looked within
//  the last ten minutes, so this is safe to call on every visit -
//  and it means an edit made in a sheet reaches the board within
//  minutes, without anybody pressing anything.
//
//  Nothing here waits on the answer to show the board. The board
//  reads Firestore live (onSnapshot), so when the sync does write
//  a change, every open browser redraws on its own.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { getFirebaseAuth } from "../firebase";

export interface SyncReport {
  ok: boolean;
  outcome: "fresh" | "unchanged" | "synced" | "failed";
  checkedAt: number;
  created: number;
  updated: number;
  removed: number;
  displaced: string[];
  problems: string[];
  sessionsFound: number;
  from: string;
  to: string;
  error?: string;
}

export async function requestTimetableSync(force = false): Promise<SyncReport | null> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const res = await fetch("/api/timetable/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ force }),
  });
  return (await res.json()) as SyncReport;
}

/**
 * Fires once per mounted page, for signed-in visitors only.
 *
 * The ref guard matters: React runs effects twice in development's
 * strict mode, and without it every board visit would ask the server
 * twice. The server would shrug both times, but there is no reason to
 * make the round trip.
 */
export function useTimetableSync(enabled: boolean): void {
  const asked = useRef(false);
  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    requestTimetableSync(false).catch(() => {
      // A sheet being unreachable must never stop the board drawing.
      // Admin -> Timetable shows the failure and why.
    });
  }, [enabled]);
}

/** Admin -> Timetable's "Sync now", with its result. */
export function useManualSync() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await requestTimetableSync(true);
      if (!r) setError("You need to be signed in to sync the timetable.");
      else {
        setReport(r);
        if (!r.ok) setError(r.error || "The sync could not finish.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, report, error };
}
