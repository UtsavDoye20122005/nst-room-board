"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BoardGrid } from "@/components/BoardGrid";
import { BookingModal } from "@/components/BookingModal";
import { SessionSheet } from "@/components/SessionSheet";
import { DateNav } from "@/components/DateNav";
import { Legend } from "@/components/Legend";
import { NextUpStrip } from "@/components/NextUpStrip";
import { FreeRoomFinder } from "@/components/FreeRoomFinder";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { shiftDays, todayISO } from "@/lib/dates";
import { slotRange } from "@/lib/slots";
import { YEARS, yearLabel } from "@/lib/seedData";
import type { Booking, Room } from "@/lib/types";

type Density = "comfortable" | "compact";

export default function BoardPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="p-10 text-center text-[13.5px] text-muted">Loading the board…</div>}>
        <BoardBody />
      </Suspense>
    </AppShell>
  );
}

function BoardBody() {
  const { profile } = useAuth();
  const campus = useCampus();
  const params = useSearchParams();
  // The calendar links here as /board?date=YYYY-MM-DD.
  const [date, setDate] = useState(() => params.get("date") || todayISO());
  const [filterBatch, setFilterBatch] = useState("all");
  const [booking, setBooking] = useState<{ room: Room; slot: number } | null>(null);
  const [open, setOpen] = useState<Booking | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [weekFind, setWeekFind] = useState(false);
  const [density, setDensity] = useState<Density>("comfortable");

  const isFaculty = profile?.role === "faculty" || profile?.role === "admin";

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("nst-board-density");
      if (saved === "compact" || saved === "comfortable") setDensity(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function setDensityPersist(next: Density) {
    setDensity(next);
    try {
      window.localStorage.setItem("nst-board-density", next);
    } catch {
      /* ignore */
    }
  }

  // Board only ever needs to see the one day currently on screen, not
  // the whole schedule - see setBookingsWindow's own comment for why
  // that matters at real scale. The free-room finder can ask for a week.
  useEffect(() => {
    campus.setBookingsWindow(date, weekFind ? shiftDays(date, 6) : date);
  }, [date, weekFind]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpNow = useCallback(() => {
    setDate(todayISO());
    setFocusNonce((n) => n + 1);
  }, []);

  const dayList = campus.bookingsOn(date);

  const alerts = useMemo(
    () => dayList.filter((b) => b.status === "cancelled" || Boolean(b.movedFrom)),
    [dayList]
  );

  return (
    <>
      <DateNav
        date={date}
        onChange={setDate}
        onJumpNow={jumpNow}
        right={
          <>
            <div className="seg" role="group" aria-label="Board density">
              <button
                type="button"
                className={"seg-item " + (density === "comfortable" ? "seg-item-on" : "")}
                onClick={() => setDensityPersist("comfortable")}
              >
                Comfortable
              </button>
              <button
                type="button"
                className={"seg-item " + (density === "compact" ? "seg-item-on" : "")}
                onClick={() => setDensityPersist("compact")}
              >
                Compact
              </button>
            </div>
            {isFaculty ? (
              <select
                className="input w-auto"
                value={filterBatch}
                aria-label="Filter by batch"
                onChange={(e) => setFilterBatch(e.target.value)}
              >
                <option value="all">All batches</option>
                {YEARS.map((y) => {
                  const ofYear = campus.batches.filter((b) => b.year === y);
                  if (!ofYear.length) return null;
                  return (
                    <optgroup key={y} label={yearLabel(y)}>
                      {ofYear.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            ) : null}
          </>
        }
      />

      <NextUpStrip date={date} bookings={dayList} onOpen={setOpen} />

      <FreeRoomFinder
        date={date}
        canBook={Boolean(isFaculty)}
        onHorizonChange={(_from, to) => setWeekFind(to > date)}
        onJumpDate={setDate}
        onBook={(room, iso, slot) => {
          setDate(iso);
          setBooking({ room, slot });
        }}
      />

      {alerts.length ? (
        <div className="mb-5 space-y-2">
          {alerts.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setOpen(b)}
              className={
                "flex w-full items-start gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-left text-[13.5px] transition hover:brightness-[.98] " +
                (b.status === "cancelled"
                  ? "border-off-line bg-off-soft"
                  : "border-moved-line bg-moved-soft")
              }
            >
              <span
                className={
                  "mt-px shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[.09em] " +
                  (b.status === "cancelled" ? "bg-off text-white" : "bg-moved text-white")
                }
              >
                {b.status === "cancelled" ? "Cancelled" : "Room change"}
              </span>
              <div>
                <strong className="font-semibold">{b.subject}</strong>
                {b.title ? " — " + b.title : ""} ·{" "}
                {b.status === "cancelled" ? (
                  <>
                    was {campus.roomName(b.roomId)}, {slotRange(b.startSlot, b.endSlot)}
                    {b.cancelReason ? " · " + b.cancelReason : ""}
                  </>
                ) : (
                  <>
                    now in <strong className="font-semibold">{campus.roomName(b.roomId)}</strong>
                    {b.movedFrom ? " (was " + campus.roomName(b.movedFrom) + ")" : ""},{" "}
                    {slotRange(b.startSlot, b.endSlot)}
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {campus.loading ? (
        <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface p-4">
          <div className="skel mb-3 h-10 w-full" />
          <div className="grid gap-2">
            <div className="skel h-16" />
            <div className="skel h-16" />
            <div className="skel h-16" />
            <div className="skel h-16" />
          </div>
          <p className="mt-4 text-center text-[13px] text-muted">Loading the schedule…</p>
        </div>
      ) : (
        <BoardGrid
          date={date}
          canBook={Boolean(isFaculty)}
          highlightBatchId={profile?.role === "student" ? profile.batchId : undefined}
          filterBatchId={isFaculty && filterBatch !== "all" ? filterBatch : undefined}
          density={density}
          focusNonce={focusNonce}
          onBookSlot={(room, slot) => setBooking({ room, slot })}
          onOpenSession={setOpen}
        />
      )}

      <div className="mt-4">
        <Legend canBook={Boolean(isFaculty)} />
      </div>

      {booking ? (
        <BookingModal
          date={date}
          room={booking.room}
          startSlot={booking.slot}
          onClose={() => setBooking(null)}
        />
      ) : null}

      {open ? <SessionSheet booking={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
