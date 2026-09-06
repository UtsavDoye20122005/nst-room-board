"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { allowedDomainsLabel } from "@/lib/firebase";
import { Splash } from "@/components/Splash";

type Step = "email" | "code";
type Tab = "id" | "email";

export default function LoginPage() {
  const { ready, user, configured, error, clearError, signInWithGoogle, signInWithStaffId, requestLoginCode, verifyLoginCode } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("email");

  // Username + password
  const [staffId, setStaffId] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [busyId, setBusyId] = useState(false);

  // Google / email code
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [busyEmail, setBusyEmail] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (ready && user) router.replace("/");
  }, [ready, user, router]);

  if (!configured) return <Splash kind="unconfigured" />;

  function switchTab(next: Tab) {
    clearError();
    setInfo(null);
    setTab(next);
  }

  async function idSignIn() {
    clearError();
    setBusyId(true);
    try {
      await signInWithStaffId(staffId, staffPassword);
    } catch {
      /* context already set a readable error */
    } finally {
      setBusyId(false);
    }
  }

  async function sendCode() {
    clearError();
    setInfo(null);
    setBusyEmail(true);
    try {
      const message = await requestLoginCode(email);
      setInfo(message);
      setStep("code");
      setTimeout(() => codeInputRef.current?.focus(), 50);
    } catch {
      /* context already set a readable error */
    } finally {
      setBusyEmail(false);
    }
  }

  async function verify() {
    clearError();
    setBusyEmail(true);
    try {
      await verifyLoginCode(email, code);
    } catch {
      /* context already set a readable error */
    } finally {
      setBusyEmail(false);
    }
  }

  async function google() {
    clearError();
    setBusyGoogle(true);
    try {
      await signInWithGoogle();
    } catch {
      /* context already set a readable error */
    } finally {
      setBusyGoogle(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex items-baseline gap-2.5">
          <span className="rounded bg-accent px-2 py-1 font-mono text-[12px] font-semibold tracking-[.14em] text-accent-ink">
            NST
          </span>
          <span>
            <span className="block text-[19px] font-semibold leading-tight">Room Board</span>
            <span className="text-xs text-muted">Classroom &amp; exam allocation</span>
          </span>
        </div>

        <div className="card p-6">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            Use whichever way you were given — an ID and password, or your Google/email account.
          </p>

          <div className="mt-4 flex gap-1 rounded-lg border border-line bg-surface-2 p-1">
            <button
              type="button"
              className={
                "flex-1 rounded-md py-1.5 text-[13px] font-medium transition-colors " +
                (tab === "email" ? "bg-surface shadow-sm" : "text-muted hover:text-ink")
              }
              onClick={() => switchTab("email")}
            >
              Email / Google
            </button>
            <button
              type="button"
              className={
                "flex-1 rounded-md py-1.5 text-[13px] font-medium transition-colors " +
                (tab === "id" ? "bg-surface shadow-sm" : "text-muted hover:text-ink")
              }
              onClick={() => switchTab("id")}
            >
              Username &amp; password
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{error}</div>
          ) : null}
          {info && !error ? (
            <div className="mt-4 rounded border border-accent-line bg-accent-soft px-3 py-2 text-[13px]">{info}</div>
          ) : null}

          {tab === "email" ? (
            <div className="mt-5">
              <button
                className="btn btn-primary w-full py-2"
                disabled={busyGoogle}
                onClick={() => void google()}
              >
                {busyGoogle ? "Opening Google…" : "Sign in with Google"}
              </button>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="label-xs">or verify your email</span>
                <span className="h-px flex-1 bg-line" />
              </div>

              {step === "email" ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendCode();
                  }}
                >
                  <label className="block">
                    <span className="label-xs">Email</span>
                    <input
                      className="input mt-1"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={"you@" + allowedDomainsLabel().split(" or ")[0].replace(/^@/, "")}
                      autoComplete="email"
                      required
                    />
                    <span className="mt-1 block text-[12px] text-muted">
                      {allowedDomainsLabel()} — we'll send a 6-digit verification code.
                    </span>
                  </label>
                  <button className="btn w-full py-2" disabled={busyEmail} type="submit">
                    {busyEmail ? "Sending…" : "Send me a code"}
                  </button>
                </form>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void verify();
                  }}
                >
                  <label className="block">
                    <span className="label-xs">6-digit code sent to {email}</span>
                    <input
                      ref={codeInputRef}
                      className="input mt-1 text-center font-mono text-[20px] tracking-[.3em]"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      maxLength={6}
                      required
                    />
                  </label>
                  <button className="btn btn-primary w-full py-2" disabled={busyEmail || code.length !== 6} type="submit">
                    {busyEmail ? "Verifying…" : "Verify & sign in"}
                  </button>
                  <button
                    type="button"
                    className="w-full text-center text-[12.5px] text-accent underline-offset-2 hover:underline"
                    onClick={() => { clearError(); setInfo(null); setCode(""); setStep("email"); }}
                  >
                    Use a different email
                  </button>
                </form>
              )}

              <p className="mt-4 text-center text-[12px] text-muted">
                First time here? You&apos;ll fill in your name and years right after.
              </p>
            </div>
          ) : (
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void idSignIn();
              }}
            >
              <label className="block">
                <span className="label-xs">Username</span>
                <input
                  className="input mt-1"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  autoComplete="username"
                  placeholder="e.g. yourid"
                  required
                />
              </label>
              <label className="block">
                <span className="label-xs">Password</span>
                <div className="relative mt-1">
                  <input
                    className="input pr-16"
                    type={showStaffPassword ? "text" : "password"}
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 px-3 text-[11.5px] text-muted hover:text-accent"
                    onClick={() => setShowStaffPassword((v) => !v)}
                    tabIndex={-1}
                  >
                    {showStaffPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              <button className="btn btn-primary w-full py-2" disabled={busyId} type="submit">
                {busyId ? "Signing in…" : "Sign in"}
              </button>
              <p className="mt-1 text-center text-[12px] text-muted">
                For accounts set up ahead of time by an admin — no inbox needed.
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
