"use client";

// ============================================================
//  Signs people in and keeps their profile in React context.
//
//  Three ways in:
//    - ID + password             (no real inbox needed - the account
//                                  was created ahead of time by
//                                  createAdminLogin.mjs or
//                                  createTeacherLogin.mjs; this is the
//                                  normal path now)
//    - Sign in with Google       (restricted to your college email
//                                  domains - Google already proves the
//                                  inbox is yours, no extra step needed)
//    - Email + verification code (same domain restriction, proves it
//                                  the same way for anyone without
//                                  Google sign-in - see /api/auth/*)
// ============================================================

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { idLoginEmail, firebaseConfigured, getDb, getFirebaseAuth, isAllowedEmail, allowedDomainsLabel } from "./firebase";
import type { Role, UserProfile } from "./types";

interface AuthState {
  ready: boolean;
  user: User | null;
  profile: UserProfile | null;
  /** True once we actually know whether this person has a profile document. */
  profileReady: boolean;
  /** Set when the profile could not be READ - which is not the same as not having one. */
  profileError: string | null;
  configured: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  /** ID + password login - works for any account created by createAdminLogin.mjs or createTeacherLogin.mjs, not tied to a person's inbox. */
  signInWithStaffId: (id: string, password: string) => Promise<void>;
  /** Sends a 6-digit code to a college address. Throws if the domain isn't allowed. */
  requestLoginCode: (email: string) => Promise<string>;
  /** Checks the code and signs in, creating the account the first time. */
  verifyLoginCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveProfile: (patch: Partial<UserProfile>) => Promise<void>;
  createProfile: (input: { name: string; role: Exclude<Role, "admin">; subjects: string[]; years: number[]; year?: number; batchId?: string }) => Promise<void>;
  clearError: () => void;
}

const Ctx = createContext<AuthState | null>(null);

const DOMAIN_MESSAGE =
  "Use your college account (" + allowedDomainsLabel() + "). Personal addresses cannot access the room board.";

function friendlyAuthError(code: string): string {
  switch (code) {
    case "auth/invalid-custom-token":
    case "auth/custom-token-mismatch":
      return "That sign-in link is stale. Request a fresh code and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The Google window closed before sign-in finished. Try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google popup. Allow popups for this site, or use a verification code instead.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That ID or password isn't right.";
    case "auth/network-request-failed":
      return "Network problem reaching Firebase. Check your connection.";
    case "auth/operation-not-allowed":
      return "That sign-in method is switched off in Firebase. Enable it under Authentication -> Sign-in method.";
    default:
      return "Sign-in failed (" + code + ").";
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!firebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Watch the auth session.
  useEffect(() => {
    if (!firebaseConfigured) return;
    const unsub = onAuthStateChanged(getFirebaseAuth(), (u) => {
      // No domain check here, on purpose. This callback runs again on
      // every token refresh, so re-checking the domain meant a session
      // that signed in perfectly well could be thrown out mid-use the
      // moment the check disagreed - and because u.email arrives a beat
      // late on the custom-token path, that ejection landed SECONDS
      // after an apparently successful sign-in, which is exactly what
      // "it logs me out after 20 seconds" looked like.
      //
      // The domain is still enforced, in the three places that can
      // actually be trusted: at the sign-in gate below, again on the
      // server in /api/auth/*, and for real in firestore.rules. A
      // disallowed account can hold a Firebase session and still read
      // and write nothing.
      setUser(u);
      setReady(true);
    });
    return unsub;
  }, []);

  // Watch this person's profile document live, so an admin changing
  // someone's role takes effect without a re-login.
  useEffect(() => {
    if (!firebaseConfigured || !user) {
      setProfile(null);
      setProfileError(null);
      setProfileReady(false);
      return;
    }
    setProfileError(null);
    setProfileReady(false);
    const ref = doc(getDb(), "users", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setProfile(snap.exists() ? ({ ...(snap.data() as UserProfile), uid: user.uid }) : null);
        setProfileError(null);
        setProfileReady(true);
      },
      (e) => {
        // A read that FAILED is not the same as "this person has no
        // profile yet". Blanking the profile on an error bounced a
        // signed-in teacher to the onboarding form - or, mid-session,
        // straight off the page - every time Firestore hiccuped or the
        // rules had not been deployed. Keep what we already have and
        // say what went wrong instead.
        setProfileError(
          e.message +
            (e.message.toLowerCase().includes("permission")
              ? " — check that firestore.rules is deployed and that your email domain is listed in it."
              : "")
        );
        setProfileReady(true);
      }
    );
    return unsub;
  }, [user]);

  const api = useMemo<AuthState>(() => {
    async function guard(fn: () => Promise<void>) {
      setError(null);
      try {
        await fn();
      } catch (e) {
        const code = (e as { code?: string }).code || "";
        setError(code ? friendlyAuthError(code) : (e as Error).message || "Something went wrong.");
        throw e;
      }
    }

    return {
      ready,
      user,
      profile,
      profileReady,
      profileError,
      configured: firebaseConfigured,
      error,
      clearError: () => setError(null),

      signInWithGoogle: () =>
        guard(async () => {
          const provider = new GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          const res = await signInWithPopup(getFirebaseAuth(), provider);
          if (!isAllowedEmail(res.user.email)) {
            await fbSignOut(getFirebaseAuth());
            throw new Error(DOMAIN_MESSAGE);
          }
        }),

      signInWithStaffId: (id, password) =>
        guard(async () => {
          if (!id.trim() || !password) throw new Error("Enter your ID and password.");
          await signInWithEmailAndPassword(getFirebaseAuth(), idLoginEmail(id), password);
        }),

      // Step 1: ask the server to email a 6-digit code. The server checks
      // the domain again (never trust the client alone), so this throws
      // with the same message even if someone bypasses the UI check.
      requestLoginCode: (email) => {
        let message = "";
        return guard(async () => {
          if (!isAllowedEmail(email)) throw new Error(DOMAIN_MESSAGE);
          const res = await fetch("/api/auth/request-code", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.message || "Could not send the code.");
          message = data.message as string;
        }).then(() => message);
      },

      // Step 2: the server checks the code and, if it matches, hands back
      // a custom token proving that email is verified. Signing in with it
      // is a completely normal Firebase Auth session from this point on.
      verifyLoginCode: (email, code) =>
        guard(async () => {
          if (!isAllowedEmail(email)) throw new Error(DOMAIN_MESSAGE);
          const res = await fetch("/api/auth/verify-code", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.message || "That code did not work.");
          await signInWithCustomToken(getFirebaseAuth(), data.token as string);
        }),

      signOut: async () => {
        await fbSignOut(getFirebaseAuth());
        setProfile(null);
      },

      createProfile: (input) =>
        guard(async () => {
          if (!user) throw new Error("Not signed in.");
          const now = Date.now();
          const rec: UserProfile = {
            uid: user.uid,
            email: (user.email || "").toLowerCase(),
            name: input.name.trim(),
            role: input.role,
            subjects: input.subjects,
            years: input.years,
            createdAt: now,
            updatedAt: now,
          };
          if (input.role === "student") {
            rec.year = input.year;
            rec.batchId = input.batchId;
          }
          await setDoc(doc(getDb(), "users", user.uid), rec);
        }),

      saveProfile: (patch) =>
        guard(async () => {
          if (!user) throw new Error("Not signed in.");
          await updateDoc(doc(getDb(), "users", user.uid), { ...patch, updatedAt: Date.now() });
        }),
    };
  }, [ready, user, profile, profileReady, profileError, error]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>.");
  return v;
}
