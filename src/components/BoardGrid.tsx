"use client";

// ============================================================
//  The board itself: hours down the side, rooms across the top.
//
//  Red   = taken. Shows the subject, a short description, the
//          teacher's name and which batches are in there.
//  Green = free. A teacher can click it to book.
//  Grey  = the session that was here got cancelled. The hour is
//          free again, so a teacher can still book over it.
// ============================================================

import { SLOTS, currentSlotIndex } from "@/lib/slots";
import { todayISO } from "@/lib/dates";
import { useCampus } from "@/lib/campusContext";
import type { Booking, Room } from "@/lib/types";

export interface BoardGridProps {
  date: string;
  canBook: boolean;
  /** Highlight sessions belonging to this batch (student view). */
  highlightBatchId?: string;
  /** Grey out anything not matching this batch filter. */
  filterBatchId?: string;
  onBookSlot: (room: Room, slot: number) => void;
  onOpenSession: (booking: Booking) => void;
}

/** One column's worth of cells - one box per half-hour row, always,
 *  even for a multi-hour booking (it just repeats across each row it
 *  covers). Keeps every row the same size and each half-hour clickable
 *  on its own, instead of merging a long booking into one tall box. */
interface ColumnCell {
  slotIndex: number;
  span: number;
  taken?: Booking;
  cancelled?: Booking;
}

function buildColumn(
  roomId: string,
  date: string,
  occupant: (date: string, roomId: string, slot: number) => Booking | undefined,
  anyAt: (date: string, roomId: string, slot: number) => Booking | undefined
): Map<number, ColumnCell> {
  const bySlot = new Map<number, ColumnCell>();
  for (const slot of SLOTS) {
    const taken = occupant(date, roomId, slot.index);
    if (taken) {
      bySlot.set(slot.index, { slotIndex: slot.index, span: 1, taken });
      continue;
    }
    const shadow = anyAt(date, roomId, slot.index);
    if (shadow && shadow.status === "cancelled") {
      bySlot.set(slot.index, { slotIndex: slot.index, span: 1, cancelled: shadow });
      continue;
    }
    bySlot.set(slot.index, { slotIndex: slot.index, span: 1 });
  }
  return bySlot;
}

export function BoardGrid({
  date,
  canBook,
  highlightBatchId,
  filterBatchId,
  onBookSlot,
  onOpenSession,
}: BoardGridProps) {
  const { rooms, occupant, anyAt, batchNames } = useCampus();
  const nowSlot = date === todayISO() ? currentSlotIndex() : -1;
  const activeRooms = rooms.filter((r) => r.active);

  // One merged column per room, built once per render rather than once
  // per row - a multi-hour booking only needs to be looked up once.
  const columns = new Map(activeRooms.map((r) => [r.id, buildColumn(r.id, date, occupant, anyAt)]));

  if (activeRooms.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong p-10 text-center text-[13.5px] text-muted">
        No rooms yet. An admin needs to add them under Admin → Rooms, or run <code className="font-mono">npm run seed</code>.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-[var(--shadow)]">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr>
            <th className="w-[104px] border-b border-r border-line bg-surface-2 p-3 text-left align-top">
              <span className="label-xs">Time</span>
            </th>
            {activeRooms.map((r) => (
              <th
                key={r.id}
                className="border-b border-r border-line bg-surface-2 p-3 text-left align-top last:border-r-0"
              >
                <span className="font-mono text-[11px] font-semibold tracking-[.1em] text-accent">
                  {r.name}
                </span>
                {r.note ? <span className="mt-0.5 block text-[13px] font-semibold">{r.note}</span> : null}
                <span className="mt-0.5 block text-[11px] font-normal text-muted tnum">
                  {r.capacity} seats
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot) => (
            <tr key={slot.index} className={slot.isBreak ? "bg-surface-3" : undefined}>
              <td
                className={
                  "border-b border-r border-line bg-surface-2 p-3 align-top whitespace-nowrap " +
                  (nowSlot === slot.index ? "shadow-[inset_3px_0_0_var(--accent)]" : "")
                }
              >
                <div className="font-mono text-[12.5px] font-medium tnum">{slot.start}</div>
                <div className="font-mono text-[10.5px] text-muted tnum">{slot.end}</div>
                {slot.isBreak ? <div className="label-xs mt-1">Lunch</div> : null}
                {nowSlot === slot.index ? (
                  <div className="label-xs mt-1 !text-accent">Now</div>
                ) : null}
              </td>

              {activeRooms.map((room) => {
                const cell = columns.get(room.id)!.get(slot.index)!;
                return (
                  <td
                    key={room.id}
                    className="border-b border-r border-line p-1.5 align-top last:border-r-0"
                  >
                    <Cell
                      room={room}
                      slot={slot.index}
                      taken={cell.taken}
                      cancelled={cell.cancelled}
                      isBreak={Boolean(slot.isBreak) && !cell.taken && !cell.cancelled}
                      canBook={canBook}
                      highlightBatchId={highlightBatchId}
                      filterBatchId={filterBatchId}
                      batchNames={batchNames}
                      onBookSlot={onBookSlot}
                      onOpenSession={onOpenSession}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  room,
  slot,
  taken,
  cancelled,
  isBreak,
  canBook,
  highlightBatchId,
  filterBatchId,
  batchNames,
  onBookSlot,
  onOpenSession,
}: {
  room: Room;
  slot: number;
  taken?: Booking;
  cancelled?: Booking;
  /** This exact slot is free AND falls in the lunch window. */
  isBreak?: boolean;
  canBook: boolean;
  highlightBatchId?: string;
  filterBatchId?: string;
  batchNames: (ids: string[]) => string;
  onBookSlot: (room: Room, slot: number) => void;
  onOpenSession: (b: Booking) => void;
}) {
  const base =
    "flex min-h-[70px] w-full flex-col gap-1 rounded border p-2 text-left transition-colors";

  // ---------- taken: red (one box per half-hour row, same size as a free/book box) ----------
  if (taken) {
    const mine = highlightBatchId ? taken.batchIds.includes(highlightBatchId) : false;
    const dimmed =
      (filterBatchId && !taken.batchIds.includes(filterBatchId)) ||
      (highlightBatchId && !mine);

    const isExam = taken.kind === "exam";

    return (
      <button
        className={
          base +
          (isExam ? " border-exam-line bg-exam-soft" : " border-busy-line bg-busy-soft") +
          " hover:brightness-[.98] " +
          (dimmed ? "opacity-45 " : "") +
          (mine ? "ring-2 ring-inset ring-accent" : "")
        }
        onClick={() => onOpenSession(taken)}
        title={"Booked by " + taken.facultyName}
      >
        <span
          className={
            "font-mono text-[9.5px] font-semibold uppercase tracking-[.1em] " +
            (isExam ? "text-exam" : "text-busy")
          }
        >
          {taken.kind}
          {taken.movedFrom ? " · moved" : ""}
        </span>
        <span className="text-[13px] font-semibold leading-tight [overflow-wrap:anywhere]">
          {taken.subject}
        </span>
        {taken.title ? (
          <span className="text-[11.5px] leading-tight text-ink-2 [overflow-wrap:anywhere]">
            {taken.title}
          </span>
        ) : null}
        <span className="text-[11px] text-muted [overflow-wrap:anywhere]">{taken.facultyName}</span>
        {taken.batchIds.length ? (
          <span className="mt-0.5 block text-[10px] leading-tight text-muted [overflow-wrap:anywhere]">
            {batchNames(taken.batchIds)}
          </span>
        ) : null}
      </button>
    );
  }

  // ---------- cancelled shadow: grey, still bookable ----------
  if (cancelled) {
    const inner = (
      <>
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.1em] text-off">
          Cancelled
        </span>
        <span className="text-[13px] font-semibold leading-tight line-through decoration-[1.5px] [overflow-wrap:anywhere]">
          {cancelled.subject}
        </span>
        <span className="text-[11px] text-muted">{cancelled.facultyName}</span>
        {canBook ? (
          <span className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[.08em] text-free">
            + room is free
          </span>
        ) : null}
      </>
    );

    return canBook ? (
      <button
        className={base + " border-off-line bg-off-soft hover:border-free hover:bg-free-soft"}
        onClick={() => onOpenSession(cancelled)}
      >
        {inner}
      </button>
    ) : (
      <div className={base + " border-off-line bg-off-soft"}>{inner}</div>
    );
  }

  // ---------- lunch: free, but not really bookable in spirit ----------
  if (isBreak) {
    return (
      <div
        className={base + " items-center justify-center border-dashed border-line-strong bg-transparent"}
        aria-label="Lunch break"
      >
        <span className="label-xs">Lunch</span>
      </div>
    );
  }

  // ---------- free: green ----------
  if (!canBook) {
    return (
      <div
        className={base + " border-dashed border-free-line/70 bg-transparent"}
        aria-label="Free"
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[.06em] text-muted">
          available
        </span>
      </div>
    );
  }

  return (
    <button
      className={
        base +
        " border-dashed border-free-line bg-transparent hover:border-solid hover:border-free hover:bg-free-soft"
      }
      onClick={() => onBookSlot(room, slot)}
      aria-label={"Book " + room.name}
    >
      <span className="font-mono text-[10.5px] uppercase tracking-[.06em] text-free">+ book</span>
      <span className="text-[10.5px] text-muted tnum">{room.capacity} seats</span>
    </button>
  );
}
