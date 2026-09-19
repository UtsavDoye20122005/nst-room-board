"use client";

import { useEffect, useState } from "react";
import { prettyDate, relativeDay, shiftDays, todayISO } from "@/lib/dates";

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-[12.5px] text-muted tnum">
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export function DateNav({
  date,
  onChange,
  onJumpNow,
  right,
}: {
  date: string;
  onChange: (iso: string) => void;
  onJumpNow?: () => void;
  right?: React.ReactNode;
}) {
  const rel = relativeDay(date);
  const isToday = date === todayISO();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "ArrowLeft") onChange(shiftDays(date, -1));
      if (e.key === "ArrowRight") onChange(shiftDays(date, 1));
      if (e.key === "t" || e.key === "T") onChange(todayISO());
      if ((e.key === "n" || e.key === "N") && onJumpNow) onJumpNow();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [date, onChange, onJumpNow]);

  return (
    <div className="flex flex-wrap items-center gap-4 pb-5">
      <div className="flex items-center gap-1.5">
        <button className="btn px-2.5" aria-label="Previous day" onClick={() => onChange(shiftDays(date, -1))}>
          &larr;
        </button>
        <button className={"btn " + (isToday ? "btn-primary" : "")} onClick={() => onChange(todayISO())}>
          Today
        </button>
        {onJumpNow ? (
          <button className="btn" onClick={onJumpNow} title="Scroll to the current hour (N)">
            Now
          </button>
        ) : null}
        <button className="btn px-2.5" aria-label="Next day" onClick={() => onChange(shiftDays(date, 1))}>
          &rarr;
        </button>
      </div>

      <div className="min-w-[190px]">
        <div className="flex items-center gap-2">
          <div className="label-xs">{rel || "Schedule"}</div>
          {isToday ? (
            <>
              <span className="now-dot" />
              <LiveClock />
            </>
          ) : null}
        </div>
        <div className="text-[20px] font-semibold tracking-tight">{prettyDate(date)}</div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="input w-auto"
          value={date}
          aria-label="Jump to a date"
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
        {right}
      </div>
    </div>
  );
}
