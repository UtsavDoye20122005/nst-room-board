"use client";

export function PageHeader({
  kicker,
  title,
  children,
  actions,
}: {
  kicker?: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="card card-pad mb-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {kicker ? <div className="label-xs">{kicker}</div> : null}
          <h1 className={"text-[20px] font-semibold tracking-tight " + (kicker ? "mt-1" : "")}>{title}</h1>
          {children ? <div className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-muted">{children}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p className="mt-4 text-[13.5px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}

export function SegTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={"seg-item " + (value === t.id ? "seg-item-on" : "")}
        >
          {t.label}
          {t.badge ? <span className="seg-badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
