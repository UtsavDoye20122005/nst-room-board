"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BoardGrid } from "@/components/BoardGrid";
import { BookingModal } from "@/components/BookingModal";
import { SessionSheet } from "@/components/SessionSheet";
import { DateNav } from "@/components/DateNav";
import { Legend } from "@/components/Legend";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { todayISO } from "@/lib/dates";
import { slotRange } from "@/lib/slots";
import { YEARS, yearLabel } from "@/lib/seedData";
import type { Booking, Room } from "@/lib/types";

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

  const isFaculty = profile?.role === "faculty" || profile?.role === "admin";

  // Board only ever needs to see the one day currently on screen, not
  // the whole schedule - see setBookingsWindow's own comment for why
  // that matters at real scale.
  useEffect(() => {
    campus.setBookingsWindow(date, date);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

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
        right={
          <>
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

      {alerts.length ? (
        <div className="mb-5 space-y-2">
          {alerts.map((b) => (
            <div
              key={b.id}
              className={
                "flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[13.5px] " +
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
            </div>
          ))}
        </div>
      ) : null}

      {campus.loading ? (
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-[13.5px] text-muted">
          Loading the schedule…
        </div>
      ) : (
        <BoardGrid
          date={date}
          canBook={Boolean(isFaculty)}
          filterBatchId={isFaculty && filterBatch !== "all" ? filterBatch : undefined}
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
