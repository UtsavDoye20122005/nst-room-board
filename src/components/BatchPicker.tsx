"use client";

// ============================================================
//  Year and batch selection.
//
//  This is the "select the whole batch in one go" control the
//  faculty asked for: tick 2nd Year and every 2nd-year batch is
//  selected at once. Ticking both years invites both.
// ============================================================

import { useCampus } from "@/lib/campusContext";
import { YEARS, yearLabel } from "@/lib/seedData";

export function BatchPicker({
  years,
  batchIds,
  onChange,
  hideIds = [],
}: {
  years: number[];
  batchIds: string[];
  onChange: (next: { years: number[]; batchIds: string[] }) => void;
  /**
   * Batches to leave off the list entirely - used when splitting a lab
   * across rooms, so a batch already assigned to another room can't
   * also be picked here.
   */
  hideIds?: string[];
}) {
  const { batches: allBatches } = useCampus();
  const batches = hideIds.length ? allBatches.filter((b) => !hideIds.includes(b.id)) : allBatches;

  function idsForYear(y: number): string[] {
    return batches.filter((b) => b.year === y).map((b) => b.id);
  }

  function toggleYear(y: number) {
    const ids = idsForYear(y);
    if (years.includes(y)) {
      onChange({
        years: years.filter((x) => x !== y),
        batchIds: batchIds.filter((id) => !ids.includes(id)),
      });
    } else {
      onChange({
        years: [...years, y].sort(),
        batchIds: Array.from(new Set([...batchIds, ...ids])),
      });
    }
  }

  function toggleBatch(id: string, year: number) {
    const next = batchIds.includes(id) ? batchIds.filter((x) => x !== id) : [...batchIds, id];
    const yearStillHasOne = batches.some((b) => b.year === year && next.includes(b.id));
    const nextYears = yearStillHasOne
      ? Array.from(new Set([...years, year])).sort()
      : years.filter((y) => y !== year);
    onChange({ years: nextYears, batchIds: next });
  }

  return (
    <div className="space-y-3">
      {YEARS.map((y) => {
        const ofYear = batches.filter((b) => b.year === y);
        const ids = ofYear.map((b) => b.id);
        const allOn = ids.length > 0 && ids.every((id) => batchIds.includes(id));
        const someOn = ids.some((id) => batchIds.includes(id));

        return (
          <div key={y} className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-semibold">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn && !allOn;
                  }}
                  onChange={() => toggleYear(y)}
                />
                {yearLabel(y)}
              </label>
              <span className="label-xs">
                {ofYear.length === 0 ? "no batches" : ids.filter((i) => batchIds.includes(i)).length + " of " + ofYear.length}
              </span>
            </div>

            {ofYear.length ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {ofYear.map((b) => (
                  <label
                    key={b.id}
                    className={
                      "cursor-pointer rounded-full border px-2.5 py-1 text-[12px] transition-colors " +
                      (batchIds.includes(b.id)
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line-strong bg-surface hover:bg-surface-3")
                    }
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={batchIds.includes(b.id)}
                      onChange={() => toggleBatch(b.id, y)}
                    />
                    {b.name}
                    <span className="ml-1.5 font-mono text-[10px] text-muted tnum">{b.strength}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-muted">
                No batches for this year yet — an admin adds them under Admin → Batches.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
