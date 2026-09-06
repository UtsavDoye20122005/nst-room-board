"use client";

// ============================================================
//  The frame every signed-in page sits in: brand, navigation,
//  who you are, sign out. It also guards the page - if you are
//  not signed in, or have not finished your profile, it sends
//  you where you need to go instead of rendering a broken page.
// ============================================================

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useCampus } from "@/lib/campusContext";
import { Splash } from "./Splash";

interface NavItem { href: string; label: string; badge?: number }

export function AppShell({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const { ready, user, profile, profileReady, profileError, configured, signOut } = useAuth();
  const campus = useCampus();
  const router = useRouter();
  const pathname = usePathname();

  // Nothing is decided until profileReady. "The profile listener has
  // not answered yet" and "this person has no profile" used to look
  // identical here, so every page load pushed an existing user to the
  // onboarding form for the moment before Firestore replied - and a
  // failed read pushed them there for good.
  useEffect(() => {
    if (!configured || !ready) return;
    if (!user) router.replace("/login");
    else if (profileReady && !profileError && !profile) router.replace("/onboarding");
  }, [ready, user, profile, profileReady, profileError, configured, router]);

  if (!configured) return <Splash kind="unconfigured" />;
  if (!ready || !user) return <Splash kind="loading" />;
  if (profileError) return <Splash kind="error" message={"Could not read your profile. " + profileError} />;
  if (!profileReady || !profile) return <Splash kind="loading" />;

  const isFaculty = profile.role === "faculty" || profile.role === "admin";
  const isAdmin = profile.role === "admin";

  if (requireAdmin && !isAdmin) {
    return (
      <Frame profile={profile} nav={navFor(isFaculty, isAdmin)} pathname={pathname} onSignOut={signOut}>
        <div className="card p-6">
          <div className="label-xs text-busy">Admin only</div>
          <h1 className="mt-2 text-xl font-semibold">You do not have admin access</h1>
          <p className="mt-2 max-w-prose text-ink-2">
            Ask whoever set the board up to open Admin → People and switch your role to admin.
          </p>
        </div>
      </Frame>
    );
  }

  return (
    <Frame profile={profile} nav={navFor(isFaculty, isAdmin)} pathname={pathname} onSignOut={signOut}>
      {campus.error ? (
        <div className="mb-5 rounded-lg border border-busy-line bg-busy-soft p-4 text-[13.5px]">
          <strong className="font-semibold">The board could not load everything.</strong>
          <p className="mt-1 text-ink-2">{campus.error}</p>
        </div>
      ) : null}
      {children}
    </Frame>
  );
}

function navFor(isFaculty: boolean, isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [
    { href: "/board", label: "Day board" },
    { href: "/calendar", label: "Calendar" },
    { href: "/my", label: isFaculty ? "My bookings" : "My schedule" },
    { href: "/notices", label: "Notices" },
  ];
  if (isAdmin) items.push({ href: "/admin", label: "Admin" });
  return items;
}

function Frame({
  children,
  profile,
  nav,
  pathname,
  onSignOut,
}: {
  children: React.ReactNode;
  profile: { name: string; role: string; email: string; subjects?: string[]; batchId?: string };
  nav: NavItem[];
  pathname: string;
  onSignOut: () => Promise<void>;
}) {
  const { batchById } = useCampus();
  const roleLabel = profile.role === "admin" ? "Admin" : profile.role === "faculty" ? "Faculty" : "Student";
  const isStudent = profile.role === "student";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-5 py-3">
          <Link href="/board" className="mr-auto flex items-baseline gap-2.5">
            <span className="rounded bg-accent px-2 py-1 font-mono text-[12px] font-semibold tracking-[.14em] text-accent-ink">
              NST
            </span>
            <span>
              <span className="block text-[17px] font-semibold leading-tight">Room Board</span>
              <span className="text-xs text-muted">Classroom &amp; exam allocation</span>
            </span>
          </Link>

          <div className="flex items-center gap-2.5">
            <span
              className={
                "rounded-full border px-2 py-1 font-mono text-[10.5px] uppercase tracking-[.09em] " +
                (isStudent
                  ? "border-moved-line bg-moved-soft text-moved"
                  : "border-accent-line bg-accent-soft text-accent")
              }
            >
              {roleLabel}
            </span>
            <span className="text-[13.5px] font-medium">{profile.name}</span>
            {isStudent && profile.batchId ? (
              <span className="pill">{batchById(profile.batchId)?.name || profile.batchId}</span>
            ) : null}
            {!isStudent && profile.subjects?.length ? (
              <span className="pill">{profile.subjects.slice(0, 2).join(" · ")}</span>
            ) : null}
            <Link href="/onboarding" className="btn btn-sm">Profile</Link>
            <button className="btn btn-sm" onClick={() => void onSignOut()}>Sign out</button>
          </div>
        </div>

        <nav className="mx-auto max-w-[1400px] overflow-x-auto px-5">
          <ul className="flex gap-1">
            {nav.map((n) => {
              const active = pathname === n.href;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      "inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 pb-2.5 pt-1 text-[14px] font-medium transition-colors " +
                      (active
                        ? "border-accent text-ink"
                        : "border-transparent text-muted hover:text-ink")
                    }
                  >
                    {n.label}
                    {n.badge ? (
                      <span className="rounded-full bg-busy px-1.5 font-mono text-[10px] text-white">{n.badge}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 pb-20 pt-6">{children}</main>
    </div>
  );
}
