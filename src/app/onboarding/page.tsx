"use client";

// ============================================================
//  First-login profile, and the "Profile" page afterwards.
//
//  Only two kinds of sign-in reach this app now: a real teacher via
//  their @newtonschool.co address, and the shared admin ID/password
//  login (which never reaches this page at all - its profile is
//  created directly by scripts/createAdminLogin.mjs, role: admin,
//  so it always has one already). So everyone who lands here is
//  faculty - a teacher gives their name, which years they teach, and
//  which subject(s) they teach. Picking subjects here (instead of
//  typing them at booking time) is what lets BookingModal offer a
//  dropdown of just that teacher's own subjects instead of a free-text
//  box anyone can mistype.
//
//  Students no longer sign in to this app at all - they hear about
//  room/time changes on Slack instead. An admin can still promote
//  someone to admin from Admin -> People.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { SUBJECT_SUGGESTIONS, YEARS, yearLabel } from "@/lib/seedData";
import { useToast } from "@/components/Toast";
import { Splash } from "@/components/Splash";

export default function OnboardingPage() {
  const { ready, user, profile, profileReady, configured, createProfile, saveProfile } = useAuth();
  const campus = useCampus();
  const { push } = useToast();
  const router = useRouter();

  const editing = Boolean(profile);

  const [name, setName] = useState("");
  const [years, setYears] = useState<number[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (ready && configured && !user) router.replace("/login");
  }, [ready, user, configured, router]);

  // Pre-fill from the existing profile, or from the Google display name.
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setYears(profile.years || []);
      setSubjects(profile.subjects || []);
    } else if (user?.displayName) {
      setName(user.displayName);
    }
  }, [profile, user]);

  if (!configured) return <Splash kind="unconfigured" />;
  // profileReady matters here too: rendering before the profile arrives
  // shows the first-time "create" form to someone who is only editing.
  if (!ready || !user || !profileReady) return <Splash kind="loading" />;

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr("Please enter your full name — it's shown on every room you book.");
    if (years.length === 0) return setErr("Pick which year or years you teach.");
    if (subjects.length === 0) return setErr("Pick at least one subject you teach.");

    setBusy(true);
    try {
      if (editing) {
        await saveProfile({ name: name.trim(), subjects, years });
        push("Profile saved");
      } else {
        await createProfile({ name: name.trim(), role: "faculty", subjects, years });
        push("Welcome to the board");
      }
      router.replace("/board");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[640px] px-5 py-10">
      <div className="label-xs">{editing ? "Your profile" : "Welcome"}</div>
      <h1 className="mt-2 text-2xl font-semibold">
        {editing ? "Profile" : "Tell the board who you are"}
      </h1>
      <p className="mt-2 text-[14px] text-ink-2">
        Signed in as <span className="font-mono text-[13px]">{user.email}</span>.
        {editing ? " Update anything below." : " This takes about twenty seconds and you only do it once."}
      </p>

      <div className="card mt-6 space-y-6 p-6">
        {campus.error ? (
          <div className="rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">
            <strong className="font-semibold">Could not load the campus data.</strong> {campus.error}
          </div>
        ) : null}
        {err ? (
          <div className="rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{err}</div>
        ) : null}

        {profile?.role === "admin" ? (
          <div>
            <span className="label-xs">Role</span>
            <p className="mt-1 text-[14px]">
              Admin
              <span className="ml-2 text-[12.5px] text-muted">
                Extra access on top of your everyday faculty view below.
              </span>
            </p>
          </div>
        ) : null}

        <label className="block">
          <span className="label-xs">Full name</span>
          <input
            className="input mt-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Divesh Kumar"
          />
          <span className="mt-1 block text-[12px] text-muted">
            Shown on every room you book.
          </span>
        </label>

        <div>
          <span className="label-xs">Years you teach</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {YEARS.map((y) => (
              <label
                key={y}
                className={
                  "cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] transition-colors " +
                  (years.includes(y)
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-strong bg-surface hover:bg-surface-2")
                }
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={years.includes(y)}
                  onChange={() => setYears((cur) => toggle(cur, y))}
                />
                {yearLabel(y)}
              </label>
            ))}
          </div>
        </div>

        <div>
          <span className="label-xs">Subjects you teach</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUBJECT_SUGGESTIONS.map((s) => (
              <label
                key={s}
                className={
                  "cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] transition-colors " +
                  (subjects.includes(s)
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-strong bg-surface hover:bg-surface-2")
                }
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={subjects.includes(s)}
                  onChange={() => setSubjects((cur) => toggle(cur, s))}
                />
                {s}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            This fills the Subject dropdown automatically every time you book a room.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save profile" : "Open the board"}
          </button>
          {editing ? (
            <button className="btn" onClick={() => router.replace("/board")}>Back to the board</button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
