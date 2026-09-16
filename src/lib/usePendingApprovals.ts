"use client";

// ============================================================
//  Live list of bookings waiting on an admin's sign-off.
//
//  Shared by the header badge and the Admin -> Approvals panel, so
//  both show the same number from the same subscription rather than
//  each counting separately and disagreeing.
//
//  Only admins subscribe. Anyone signed in COULD read these (the
//  board shows pending sessions to everyone anyway), but nobody else
//  has anything to do with the queue, so there's no reason to open a
//  socket for them.
// ============================================================

import { useEffect, useState } from "react";
import { useAuth } from "./authContext";
import { subscribePendingApprovals } from "./db";
import type { Booking } from "./types";

export function usePendingApprovals(): { pending: Booking[]; error: string | null } {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [pending, setPending] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setPending([]);
      setError(null);
      return;
    }
    const unsub = subscribePendingApprovals(
      (list) => {
        setPending(list);
        setError(null);
      },
      (e) => setError(e.message)
    );
    return unsub;
  }, [isAdmin]);

  return { pending, error };
}
