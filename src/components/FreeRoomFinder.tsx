"use client";

import { useMemo, useState } from "react";
import { useCampus } from "@/lib/campusContext";
import { prettyDate, shiftDays, shortDate, todayISO } from "@/lib/dates";
import { formatDuration, SLOTS, slotRange } from "@/lib/slots";
import type { Room } from "@/lib/types";

const DURATIONS = [
  { slots: 1, label: "30 min" },
  { slots: 2, label: "1 hr" },
  { slots: 3, label: "1 hr 30" },
  { slots: 4, label: "2 hrs" },
  { slots: 6, label: "3 hrs" },
] as const;

export interface FreeHit {
  room: Room;
  date: string;
  startSlot: number;
  endSlot: number;
  freeUntil: number;
}

export function FreeRoomFinder({
  date,
  canBook,
  onHorizonChange,
  onBook,
  onJumpDate,
}: {
  date: string;
  canBook: boolean;
  onHorizonChange: (from: string, to: string) => void;
  onBook: (room: Room, date: string, startSlot: number) => void;
  onJumpDate: (iso: string) => void;
}) {
  const campus = useCampus();
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState(60);
  const [dur, setDur] = useState(3);
  const [horizon, setHorizon] = useState<"day" | "week">("day");

  const toDate = horizon === "week" ? shiftDays(date, 6) : date;

  const hits = useMemo(() => {
    if (!open) return [];
    const rooms = campus.rooms.filter((r) => r.active && r.capacity >= seats);
    const days: string[] = [];
    for (let d = date; d <= toDate; d = shiftDays(d, 1)) days.push(d);

    const out: FreeHit[] = [];
    for (const day of days) {
      for (const room of rooms) {
        let s = 0;
        while (s < SLOTS.length) {
          if (campus.occupant(day, room.id, s)) {
            s += 1;
            continue;
          }
          let e = s;
          while (e + 1 < SLOTS.length && !campus.occupant(day, room.id, e + 1)) e += 1;
          const span = e - s + 1;
          if (span >= dur) {
            out.push({
              room,
              date: day,
              startSlot: s,
              endSlot: s + dur - 1,
              freeUntil: e,
            });
          }
          s = e + 1;
        }
      }
    }
    return out.slice(0, 18);
  }, [open, campus, date, toDate, seats, dur]);

  function setHorizonAndLoad(next: "day" | "week") {
    setHorizon(next);
    const to = next === "week" ? shiftDays(date, 6) : date;
    onHorizonChange(date, to);
  }

  return (
    <div className="card mb-4">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onHorizonChange(date, toDate);
          else {
            setHorizon("day");
            onHorizonChange(date, date);
          }
        }}
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">Find a free room</span>
          <span className="text-[12.5px] text-muted">
            {seats} seats · {DURATIONS.find((d) => d.slots === dur)?.label} ·{" "}
            {horizon === "week" ? "this week" : prettyDate(date)}
          </span>
        </span>
        <span className="text-[13px] text-accent">{open ? "Hide" : "Open"}</span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label-xs">Seats needed</span>
              <input
                className="input mt-1 w-[7.5rem] tnum"
                type="number"
                min={1}
                value={seats}
                onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label className="block">
              <span className="label-xs">Duration</span>
              <select className="input mt-1 w-auto" value={dur} onChange={(e) => setDur(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d.slots} value={d.slots}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="label-xs">When</span>
              <div className="seg mt-1">
                <button
                  type="button"
                  className={"seg-item " + (horizon === "day" ? "seg-item-on" : "")}
                  onClick={() => setHorizonAndLoad("day")}
                >
                  This day
                </button>
                <button
                  type="button"
                  className={"seg-item " + (horizon === "week" ? "seg-item-on" : "")}
                  onClick={() => setHorizonAndLoad("week")}
                >
                  This week
                </button>
              </div>
            </div>
          </div>

          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {hits.length === 0 ? (
              <li className="px-3 py-6 text-center text-[13px] text-muted">
                No room that size is free for {formatDuration(0, dur - 1)} on{" "}
                {horizon === "week" ? shortDate(date) + "–" + shortDate(toDate) : prettyDate(date)}.
              </li>
            ) : (
              hits.map((h) => (
                <li key={h.room.id + h.date + h.startSlot} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold">
                      {h.room.name}
                      {h.room.note ? <span className="font-normal text-ink-2"> — {h.room.note}</span> : null}
                    </div>
                    <div className="font-mono text-[12px] text-muted tnum">
                      {h.date === todayISO() ? "Today" : shortDate(h.date)} · {slotRange(h.startSlot, h.endSlot)}
                      {h.freeUntil > h.endSlot ? " · free until " + SLOTS[h.freeUntil].end : ""}
                      {" · "}
                      {h.room.capacity} seats
                    </div>
                  </div>
                  {h.date !== date ? (
                    <button className="btn btn-sm" type="button" onClick={() => onJumpDate(h.date)}>
                      Show day
                    </button>
                  ) : null}
                  {canBook ? (
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      onClick={() => onBook(h.room, h.date, h.startSlot)}
                    >
                      Book
                    </button>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
