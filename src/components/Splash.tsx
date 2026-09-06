"use client";

import Link from "next/link";

export function Splash({ kind, message }: { kind: "loading" | "unconfigured" | "error"; message?: string }) {
  if (kind === "loading") {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="text-center">
          <div className="label-xs">NST Room Board</div>
          <p className="mt-2 text-muted">Loading the board…</p>
        </div>
      </main>
    );
  }

  if (kind === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl p-6 md:p-10">
        <div className="label-xs">Setup needed</div>
        <h1 className="mt-2 text-2xl font-semibold">Firebase is not connected yet</h1>
        <p className="mt-3 max-w-prose text-ink-2">
          The app is running, but it has no database to talk to. Create a Firebase project, then copy
          <code className="mx-1 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[13px]">.env.local.example</code>
          to
          <code className="mx-1 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[13px]">.env.local</code>
          and fill in the six <code className="font-mono text-[13px]">NEXT_PUBLIC_FIREBASE_*</code> values.
        </p>
        <div className="card mt-6 p-5">
          <h2 className="font-semibold">The short version</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] text-ink-2">
            <li>Go to console.firebase.google.com and create a project.</li>
            <li>Add a Web app, copy the config values it shows you.</li>
            <li>Turn on Authentication → Google and Email/Password.</li>
            <li>Create a Firestore database in production mode.</li>
            <li>Paste the values into <code className="font-mono text-[13px]">.env.local</code> and restart <code className="font-mono text-[13px]">npm run dev</code>.</li>
          </ol>
          <p className="mt-4 text-[13px] text-muted">
            Full walkthrough with every click is in <code className="font-mono">docs/SETUP.md</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6 md:p-10">
      <div className="label-xs text-busy">Problem</div>
      <h1 className="mt-2 text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-ink-2">{message || "Unknown error."}</p>
      <Link href="/" className="btn mt-6">Back to the board</Link>
    </main>
  );
}
