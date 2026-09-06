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

  const [staffId, setStaffId] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [busyId, setBusyId] = useState(false);

  const [showOther, setShowOther] = useState(false);
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
            Use the ID and password you were given. Students don&apos;t sign in here — room and time changes go out on Slack.
          </p>

          {error ? (
            <div className="mt-4 rounded border border-busy-line bg-busy-soft px-3 py-2 text-[13px]">{error}</div>
          ) : null}
          {info && !error ? (
            <div className="mt-4 rounded border border-accent-line bg-accent-soft px-3 py-2 text-[13px]">{info}</div>
          ) : null}

          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void idSignIn();
            }}
          >
            <label className="block">
              <span className="label-xs">ID</span>
              <input
                className="input mt-1"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                autoComplete="username"
                placeholder="e.g. ashwin"
                required
              />
            </label>
            <label className="block">
              <span className="label-xs">Password</span>
              <input
                className="input mt-1"
                type="password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button className="btn btn-primary w-full py-2" disabled={busyId} type="submit">
              {busyId ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-5 border-t border-line pt-4">
            {!showOther ? (
              <button
                type="button"
                className="w-full text-center text-[12.5px] text-muted underline-offset-2 hover:text-accent hover:underline"
                onClick={() => { clearError(); setInfo(null); setShowOther(true); }}
              >
                Don&apos;t have an ID? Use Google or your college email instead
              </button>
            ) : (
              <div className="space-y-4">
                <button
                  className="btn w-full py-2"
                  disabled={busyGoogle}
                  onClick={() => void google()}
                >
                  {busyGoogle ? "Opening Google…" : "Sign in with Google"}
                </button>

                <div className="flex items-center gap-3">
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
                      <span className="label-xs">Staff email</span>
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
                        Only {allowedDomainsLabel()} works here. We&apos;ll send a 6-digit verification code.
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

                <button
                  type="button"
                  className="w-full text-center text-[12.5px] text-muted underline-offset-2 hover:underline"
                  onClick={() => { clearError(); setInfo(null); setShowOther(false); setStep("email"); setEmail(""); setCode(""); }}
                >
                  Back to ID sign-in
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
