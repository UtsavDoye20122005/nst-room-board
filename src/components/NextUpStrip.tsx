"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { todayISO } from "@/lib/dates";
import { currentSlotIndex, slotRange } from "@/lib/slots";
import { withHonorific } from "@/lib/people";
import type { Booking } from "@/lib/types";

export function NextUpStrip({
  date,
  bookings,
  onOpen,
}: {
  date: string;
  bookings: Booking[];
  onOpen: (b: Booking) => void;
}) {
  const { profile } = useAuth();
  const campus = useCampus();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, []);

  const mine = useMemo(() => {
    if (!profile) return [];
    if (profile.role === "student") {
      if (!profile.batchId) return [];
      return bookings.filter((b) => b.batchIds.includes(profile.batchId!));
    }
    return bookings.filter((b) => b.facultyUid === profile.uid);
  }, [bookings, profile]);

  const pick = useMemo(() => {
    if (mine.length === 0) return null;
    const isToday = date === todayISO();
    const nowSlot = isToday ? currentSlotIndex(new Date(now)) : -1;

    const happening =
      isToday && nowSlot >= 0
        ? mine.find((b) => b.startSlot <= nowSlot && nowSlot <= b.endSlot)
        : undefined;
    if (happening) return { booking: happening, phase: "now" as const };

    if (isToday && nowSlot >= 0) {
      const next = mine
        .filter((b) => b.startSlot > nowSlot)
        .sort((a, b) => a.startSlot - b.startSlot)[0];
      if (next) return { booking: next, phase: "next" as const };
      return { booking: null, phase: "done" as const };
    }

    if (isToday && nowSlot < 0) {
      const first = [...mine].sort((a, b) => a.startSlot - b.startSlot)[0];
      const mins = new Date(now).getHours() * 60 + new Date(now).getMinutes();
      if (mins < 9 * 60) return { booking: first, phase: "next" as const };
      return { booking: first, phase: "done" as const };
    }

    const first = [...mine].sort((a, b) => a.startSlot - b.startSlot)[0];
    return { booking: first, phase: "day" as const };
  }, [mine, date, now]);

  if (!profile) return null;

  const who =
    profile.role === "student"
      ? campus.batchById(profile.batchId || "")?.name || "your batch"
      : "you";

  if (mine.length === 0) {
    return (
      <div className="next-up mb-4">
        <div className="label-xs">Where do I go?</div>
        <p className="mt-1 text-[14px] text-ink-2">
          Nothing on this day for {who}.{" "}
          {date === todayISO() ? "You're clear." : "Pick another date, or check My bookings."}
        </p>
      </div>
    );
  }

  if (!pick || pick.phase === "done" || !pick.booking) {
    return (
      <div className="next-up mb-4">
        <div className="label-xs">Where do I go?</div>
        <p className="mt-1 text-[14px] text-ink-2">That's all for {who} today.</p>
      </div>
    );
  }

  const b = pick.booking;
  const cancelled = b.status === "cancelled";
  const moved = Boolean(b.movedFrom) && !cancelled;
  const room = campus.roomName(b.roomId);
  const from = b.movedFrom ? campus.roomName(b.movedFrom) : "";

  const heading =
    pick.phase === "now" ? "Happening now" : pick.phase === "next" ? "Next up" : "On this day";

  const walk = cancelled
    ? "Don't go — this session is cancelled" + (b.cancelReason ? " (" + b.cancelReason + ")" : "") + "."
    : moved
      ? "Go to " + room + " — it moved from " + from + "."
      : pick.phase === "now"
        ? "Head to " + room + "."
        : "Be at " + room + " for " + slotRange(b.startSlot, b.endSlot) + ".";

  return (
    <button
      type="button"
      onClick={() => onOpen(b)}
      className={
        "next-up mb-4 w-full text-left transition hover:brightness-[.99] " +
        (cancelled ? "next-up-off" : moved ? "next-up-moved" : pick.phase === "now" ? "next-up-now" : "")
      }
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-xs !text-inherit opacity-80">{heading}</span>
            {cancelled ? <span className="pill border-off-line bg-off-soft text-off">Cancelled</span> : null}
            {moved ? <span className="pill border-moved-line bg-moved-soft text-moved">Room change</span> : null}
            {pick.phase === "now" && !cancelled ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[.1em] text-accent">
                <span className="now-dot" /> Live
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[18px] font-semibold tracking-tight">
            {room}
            <span className="ml-2 font-mono text-[14px] font-medium text-muted tnum">
              {slotRange(b.startSlot, b.endSlot)}
            </span>
          </div>
          <p className={"mt-0.5 text-[14px] " + (cancelled ? "text-muted line-through" : "text-ink")}>
            {b.subject}
            {b.title ? " — " + b.title : ""}
            <span className="font-normal text-muted"> · {withHonorific(b.facultyName)}</span>
          </p>
          <p className="mt-1 text-[13px] text-ink-2">{walk}</p>
        </div>
        <span className="btn btn-sm pointer-events-none mt-1">Open</span>
      </div>
    </button>
  );
}
