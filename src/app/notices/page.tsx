"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { clockTime, shortDate, toISO } from "@/lib/dates";
import type { Notice } from "@/lib/types";

export default function NoticesPage() {
  return (
    <AppShell>
      <NoticesBody />
    </AppShell>
  );
}

const TAG: Record<Notice["kind"], { label: string; cls: string; chip: string }> = {
  cancelled: { label: "Cancelled", cls: "border-off-line bg-off-soft", chip: "bg-off text-white" },
  moved: { label: "Room change", cls: "border-moved-line bg-moved-soft", chip: "bg-moved text-white" },
  reinstated: { label: "Back on", cls: "border-free-line bg-free-soft", chip: "bg-free text-white" },
  booked: { label: "Booked", cls: "border-line bg-surface-2", chip: "bg-surface-3 text-muted" },
};

function NoticesBody() {
  const { profile } = useAuth();
  const campus = useCampus();

  const isStudent = profile?.role === "student";

  const list = useMemo(() => {
    if (!isStudent) return campus.notices;
    if (!profile?.batchId) return [];
    return campus.notices.filter(
      (n) => !n.batchIds?.length || n.batchIds.includes(profile.batchId!)
    );
  }, [campus.notices, isStudent, profile?.batchId]);

  return (
    <>
      <div className="card mb-5 p-5">
        <h1 className="text-[17px] font-semibold">Notices</h1>
        <p className="mt-1.5 max-w-prose text-[13px] text-muted">
          {isStudent
            ? "Every room change and cancellation that affects your batch, newest first. Worth a glance before you walk to a classroom."
            : "Every booking, room change and cancellation across the campus. Students only ever see the ones for their own batch."}
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-10 text-center text-[13.5px] text-muted">
          Nothing yet.
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((n) => {
            const t = TAG[n.kind] || TAG.booked;
            return (
              <div key={n.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[104px_1fr]">
                <div className="font-mono text-[12px] text-ink-2 tnum sm:pt-2.5">
                  <div>{shortDate(toISO(new Date(n.createdAt)))}</div>
                  <div className="text-muted">{clockTime(n.createdAt)}</div>
                </div>
                <div>
                  <div className={"flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[13.5px] " + t.cls}>
                    <span
                      className={
                        "mt-px shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[.09em] " + t.chip
                      }
                    >
                      {t.label}
                    </span>
                    <div className="[overflow-wrap:anywhere]">{n.text}</div>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    by {n.byName} ·{" "}
                    {n.batchIds?.length ? campus.batchNames(n.batchIds) : "all batches"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
