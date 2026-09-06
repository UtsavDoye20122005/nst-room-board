"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

type Tone = "ok" | "bad" | "info";
interface Toast { id: number; text: string; tone: Tone }

const Ctx = createContext<{ push: (text: string, tone?: Tone) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((text: string, tone: Tone = "ok") => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, text, tone }]);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), tone === "bad" ? 7000 : 4000);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              "pointer-events-auto max-w-[min(92vw,560px)] rounded-lg px-4 py-2.5 text-[13.5px] shadow-lg " +
              (t.tone === "bad"
                ? "bg-busy text-white"
                : t.tone === "info"
                  ? "bg-surface-3 text-ink border border-line-strong"
                  : "bg-ink text-paper")
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>.");
  return v;
}
