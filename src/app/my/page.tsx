"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SessionSheet } from "@/components/SessionSheet";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { subscribeMyBookings } from "@/lib/db";
import { relativeDay, shortDate, todayISO } from "@/lib/dates";
import { slotRange } from "@/lib/slots";
import type { Booking } from "@/lib/types";

export default function MyPage() {
  return (
    <AppShell>
      <MyBody />
    </AppShell>
  );
}

function MyBody() {
  const { profile } = useAuth();
  const campus = useCampus();
  const [open, setOpen] = useState<Booking | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [mine, setMine] = useState<Booking[]>([]);

  const isFaculty = profile?.role === "faculty" || profile?.role === "admin";
  const today = todayISO();

  // Own dedicated subscription, scoped by facultyUid (not by date
  // range) - one person's own bookings stay small regardless of the
  // horizon, so this never needs to touch the shared board window.
  // See setBookingsWindow's comment in campusContext.tsx for why that
  // separation matters.
  useEffect(() => {
    if (!isFaculty || !profile?.uid) { setMine([]); return; }
    return subscribeMyBookings(profile.uid, setMine);
  }, [isFaculty, profile?.uid]);

  const list = useMemo(() => {
    let l = isFaculty ? mine : [];
    if (!showPast) l = l.filter((b) => b.date >= today);
    return [...l].sort((a, b) =>
      showPast
        ? b.date.localeCompare(a.date) || b.startSlot - a.startSlot
        : a.date.localeCompare(b.date) || a.startSlot - b.startSlot
    );
  }, [mine, isFaculty, showPast, today]);

  return (
    <>
      <div className="card mb-5 p-5">
        <h1 className="text-[17px] font-semibold">{isFaculty ? "My bookings" : "My schedule"}</h1>
        <p className="mt-1.5 max-w-prose text-[13px] text-muted">
          {isFaculty ? (
            <>
              Everything booked under your name. Change a room or cancel a session and every teacher and
              student sees it within a second — and the affected batches can be emailed automatically.
            </>
          ) : (
            <>
              Every class, lab and exam on the board for{" "}
              <strong className="font-semibold text-ink">
                {profile?.batchId ? campus.batchById(profile.batchId)?.name || "your batch" : "your batch"}
              </strong>
              . Cancelled sessions stay listed in grey so you know not to turn up.
            </>
          )}
        </p>
        <label className="mt-3.5 flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
          />
          Show past sessions instead
        </label>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-10 text-center text-[13.5px] text-muted">
          {isFaculty
            ? "You have not booked anything yet. Open the day board and click a free hour."
            : "Nothing on the board for your batch yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {list.map((b) => {
            const rel = relativeDay(b.date);
            const cancelled = b.status === "cancelled";
            return (
              <div
                key={b.id}
                className="grid grid-cols-1 items-center gap-3.5 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-2 sm:grid-cols-[104px_92px_1fr_auto]"
              >
                <div className="font-mono text-[12px] text-ink-2 tnum">
                  <div>{rel || shortDate(b.date)}</div>
                  <div className="text-muted">{slotRange(b.startSlot, b.endSlot)}</div>
                </div>

                <div className="justify-self-start rounded bg-surface-3 px-2 py-1 text-center font-mono text-[11.5px] font-semibold tracking-[.06em] sm:justify-self-auto">
                  {campus.roomName(b.roomId)}
                </div>

                <div className="min-w-0">
                  <div className={"text-[14px] font-semibold " + (cancelled ? "text-muted line-through" : "")}>
                    {b.subject}
                    {b.title ? <span className="font-normal"> — {b.title}</span> : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {b.kind} · {b.facultyName} · {campus.batchNames(b.batchIds)}
                    {b.movedFrom ? " · moved from " + campus.roomName(b.movedFrom) : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={
                      "rounded border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[.1em] " +
                      (cancelled
                        ? "border-off-line bg-off-soft text-off"
                        : b.movedFrom
                          ? "border-moved-line bg-moved-soft text-moved"
                          : "border-free-line bg-free-soft text-free")
                    }
                  >
                    {cancelled ? "Cancelled" : b.movedFrom ? "Moved" : "On"}
                  </span>
                  <button className="btn btn-sm" onClick={() => setOpen(b)}>Open</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open ? <SessionSheet booking={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
