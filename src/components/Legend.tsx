"use client";

export function Legend({ canBook }: { canBook: boolean }) {
  const items = [
    { cls: "border-dashed border-free-line bg-transparent", label: canBook ? "Free — click to book" : "Free" },
    { cls: "border-busy-line bg-busy-soft", label: "Taken" },
    { cls: "border-exam-line bg-exam-soft", label: "Exam" },
    { cls: "border-dashed border-pending-line bg-pending-soft", label: "Awaiting approval" },
    { cls: "border-off-line bg-off-soft", label: "Cancelled" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius)] border border-line bg-surface px-3.5 py-2.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-xs text-muted">
          <span className={"h-3 w-3 rounded-[4px] border " + i.cls} />
          {i.label}
        </div>
      ))}
      <span className="ml-auto hidden text-[11px] text-muted sm:block">← / → day · T today · N now</span>
    </div>
  );
}
