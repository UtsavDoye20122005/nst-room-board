"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { allowedDomainsLabel } from "@/lib/firebase";
import { Splash } from "@/components/Splash";

type Step = "email" | "code";

export default function LoginPage() {
  const { ready, user, configured, error, clearError, signInWithGoogle, signInWithStaffId, requestLoginCode, verifyLoginCode } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [busyEmail, setBusyEmail] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const [showAdmin, setShowAdmin] = useState(false);
  const [adminId, setAdminId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [busyAdmin, setBusyAdmin] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace("/");
  }, [ready, user, router]);

  if (!configured) return <Splash kind="unconfigured" />;

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

  async function adminSignIn() {
    clearError();
    setBusyAdmin(true);
    try {
      await signInWithStaffId(adminId, adminPassword);
    } catch {
      /* context already set a readable error */
    } finally {
      setBusyAdmin(false);
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
          <h1 className="text-xl font-semibold">Faculty sign-in</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            Sign in with Google or your email — {allowedDomainsLabel()}. First time here? You'll fill in your name, subjects and years right after.
          </p>

          {error ? (
            <div className="mt-4 rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{error}</div>
          ) : null}
          {info && !error ? (
            <div className="mt-4 rounded border border-accent-line bg-accent-soft px-3 py-2 text-[13px]">{info}</div>
          ) : null}

          <button
            className="btn btn-primary mt-5 w-full py-2"
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
                  We'll send a 6-digit verification code to this email.
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

          <div className="mt-5 border-t border-line pt-4">
            {!showAdmin ? (
              <button
                type="button"
                className="w-full text-center text-[12.5px] text-muted underline-offset-2 hover:text-accent hover:underline"
                onClick={() => { clearError(); setInfo(null); setShowAdmin(true); }}
              >
                Sign in as admin instead
              </button>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void adminSignIn();
                }}
              >
                <div className="label-xs">Admin sign-in</div>
                <label className="block">
                  <span className="label-xs">Admin ID</span>
                  <input
                    className="input mt-1"
                    value={adminId}
                    onChange={(e) => setAdminId(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
                <label className="block">
                  <span className="label-xs">Password</span>
                  <div className="relative mt-1">
                    <input
                      className="input pr-16"
                      type={showAdminPassword ? "text" : "password"}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 px-3 text-[11.5px] text-muted hover:text-accent"
                      onClick={() => setShowAdminPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showAdminPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
                <button className="btn w-full py-2" disabled={busyAdmin} type="submit">
                  {busyAdmin ? "Signing in…" : "Sign in"}
                </button>
                <button
                  type="button"
                  className="w-full text-center text-[12.5px] text-muted underline-offset-2 hover:underline"
                  onClick={() => { clearError(); setShowAdmin(false); setAdminId(""); setAdminPassword(""); }}
                >
                  Back to Google / email sign-in
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
