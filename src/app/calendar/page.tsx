"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useCampus } from "@/lib/campusContext";
import { DOW_SHORT, MONTH_LONG, fromISO, monthGrid, todayISO } from "@/lib/dates";
import type { Booking } from "@/lib/types";

export default function CalendarPage() {
  return (
    <AppShell>
      <CalendarBody />
    </AppShell>
  );
}

function CalendarBody() {
  const campus = useCampus();
  const router = useRouter();

  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [filterBatch, setFilterBatch] = useState("all");

  const effectiveBatch = filterBatch === "all" ? undefined : filterBatch;

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);

  // Only ask Firestore for the month actually on screen, not the whole
  // schedule - see CampusState.setBookingsWindow.
  useEffect(() => {
    if (cells.length) campus.setBookingsWindow(cells[0].iso, cells[cells.length - 1].iso);
  }, [cells]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of campus.bookings) {
      // A month view is for "what's on", not "what got cancelled" - a
      // cancelled booking still shows correctly on the Day board (as the
      // room being free again), but here it was just permanent clutter:
      // a cancelled recurring series leaves one crossed-out entry on
      // every future occurrence of that weekday, forever.
      if (b.status === "cancelled") continue;
      if (effectiveBatch && !b.batchIds.includes(effectiveBatch)) continue;
      const list = map.get(b.date) || [];
      list.push(b);
      map.set(b.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startSlot - b.startSlot);
    return map;
  }, [campus.bookings, effectiveBatch]);

  function shiftMonth(n: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 pb-5">
        <div className="flex items-center gap-1.5">
          <button className="btn px-2.5" aria-label="Previous month" onClick={() => shiftMonth(-1)}>&larr;</button>
          <button className="btn" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>
            This month
          </button>
          <button className="btn px-2.5" aria-label="Next month" onClick={() => shiftMonth(1)}>&rarr;</button>
        </div>
        <div>
          <div className="label-xs">Month</div>
          <div className="text-[19px] font-semibold tracking-tight">
            {MONTH_LONG[cursor.m]} {cursor.y}
          </div>
        </div>
        <div className="ml-auto">
          <select
            className="input w-auto"
            value={filterBatch}
            aria-label="Filter by batch"
            onChange={(e) => setFilterBatch(e.target.value)}
          >
            <option value="all">All batches</option>
            {campus.batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {DOW_SHORT.map((d) => (
          <div key={d} className="label-xs bg-surface-2 px-2.5 py-2">{d}</div>
        ))}

        {cells.map((c) => {
          // Days outside the month being viewed are shown only for grid
          // alignment (so the 1st doesn't float under the wrong weekday) -
          // no event chips on them. Cramming a dimmed cell with dimmed
          // colored chips made it unreadable and looked broken.
          const list = c.inMonth ? byDate.get(c.iso) || [] : [];
          const shown = list.slice(0, 3);
          const more = list.length - shown.length;
          const isToday = c.iso === todayISO();

          return (
            <button
              key={c.iso}
              onClick={() => router.push("/board?date=" + c.iso)}
              className={
                "flex min-h-[108px] flex-col gap-1 bg-surface p-2 text-left hover:bg-surface-2 " +
                (c.inMonth ? "" : "bg-surface-2 opacity-50")
              }
            >
              <span
                className={
                  "self-start font-mono text-[12.5px] font-semibold tnum " +
                  (isToday ? "rounded bg-accent px-1.5 text-accent-ink" : "")
                }
              >
                {fromISO(c.iso).getDate()}
              </span>

              {shown.map((b) => (
                <span
                  key={b.id}
                  className={
                    "truncate rounded-[3px] border-l-2 px-1.5 py-0.5 text-[10.5px] leading-tight " +
                    (b.status === "cancelled"
                      ? "border-off bg-off-soft line-through"
                      : b.kind === "exam"
                        ? "border-exam bg-exam-soft"
                        : "border-busy bg-busy-soft")
                  }
                >
                  {campus.roomName(b.roomId)} · {b.subject}
                </span>
              ))}

              {more > 0 ? <span className="font-mono text-[9.5px] text-muted">+{more} more</span> : null}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[13px] text-muted">Click any day to open its board.</p>
    </>
  );
}
