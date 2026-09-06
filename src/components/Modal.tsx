"use client";

import { useEffect } from "react";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-[2px] sm:p-[5vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          "w-full rounded-xl border border-line-strong bg-surface shadow-2xl " +
          (wide ? "max-w-[720px]" : "max-w-[580px]")
        }
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 font-mono text-[12px] text-muted tnum">{subtitle}</p>
            ) : null}
          </div>
          <button
            className="ml-auto rounded px-1.5 text-xl leading-none text-muted hover:bg-surface-2 hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
