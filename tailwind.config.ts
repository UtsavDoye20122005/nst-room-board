import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        muted: "var(--muted)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        "accent-line": "var(--accent-line)",
        busy: "var(--busy)",
        "busy-soft": "var(--busy-soft)",
        "busy-line": "var(--busy-line)",
        free: "var(--free)",
        "free-soft": "var(--free-soft)",
        "free-line": "var(--free-line)",
        moved: "var(--moved)",
        "moved-soft": "var(--moved-soft)",
        "moved-line": "var(--moved-line)",
        off: "var(--off)",
        "off-soft": "var(--off-soft)",
        "off-line": "var(--off-line)",
        exam: "var(--exam)",
        "exam-soft": "var(--exam-soft)",
        "exam-line": "var(--exam-line)",
      },
      fontFamily: {
        sans: ["var(--font-ui)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: { DEFAULT: "6px" },
    },
  },
  plugins: [],
};

export default config;
