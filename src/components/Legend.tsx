"use client";

export function Legend({ canBook }: { canBook: boolean }) {
  const items = [
    { cls: "border-dashed border-free-line bg-transparent", label: canBook ? "Free — click to book" : "Free" },
    { cls: "border-busy-line bg-busy-soft", label: "Taken" },
    { cls: "border-off-line bg-off-soft", label: "Cancelled" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-xs text-muted">
          <span className={"h-3 w-3 rounded-[3px] border " + i.cls} />
          {i.label}
        </div>
      ))}
    </div>
  );
}
