"use client";

import { prettyDate, relativeDay, shiftDays, todayISO } from "@/lib/dates";

export function DateNav({
  date,
  onChange,
  right,
}: {
  date: string;
  onChange: (iso: string) => void;
  right?: React.ReactNode;
}) {
  const rel = relativeDay(date);
  return (
    <div className="flex flex-wrap items-center gap-4 pb-5">
      <div className="flex items-center gap-1.5">
        <button className="btn px-2.5" aria-label="Previous day" onClick={() => onChange(shiftDays(date, -1))}>
          &larr;
        </button>
        <button className="btn" onClick={() => onChange(todayISO())}>Today</button>
        <button className="btn px-2.5" aria-label="Next day" onClick={() => onChange(shiftDays(date, 1))}>
          &rarr;
        </button>
      </div>

      <div className="min-w-[190px]">
        <div className="label-xs">{rel || "Schedule"}</div>
        <div className="text-[19px] font-semibold tracking-tight">{prettyDate(date)}</div>
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
