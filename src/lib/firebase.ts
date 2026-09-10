// ============================================================
//  Firebase client setup (runs in the browser).
//
//  The NEXT_PUBLIC_* keys here are meant to be public - that is
//  how every Firebase web app works. What actually protects your
//  data is firestore.rules, not secrecy of these values.
// ============================================================

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True when .env.local has actually been filled in. */
export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

let cachedApp: FirebaseApp | null = null;

function app(): FirebaseApp {
  if (!firebaseConfigured) {
    throw new Error(
      "Firebase is not configured. Copy .env.local.example to .env.local and fill in the six NEXT_PUBLIC_FIREBASE_* values."
    );
  }
  if (!cachedApp) {
    cachedApp = getApps().length ? getApp() : initializeApp(config);
  }
  return cachedApp;
}

export function getFirebaseAuth(): Auth {
  return getAuth(app());
}

export function getDb(): Firestore {
  return getFirestore(app());
}

/** Comma-separated list from the env, lower-cased, empty means "allow all". */
export function allowedDomains(): string[] {
  const raw = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "";
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * The one non-newtonschool.co address allowed in: the shared admin
 * Google account. Everyone else needs a real college address - a
 * blanket "any gmail.com" exception used to be here, which meant
 * literally anyone with a Gmail account could sign in. This is an
 * exact-match exception for one address instead of a whole domain.
 */
export function adminGoogleEmail(): string {
  return (process.env.NEXT_PUBLIC_ADMIN_GOOGLE_EMAIL || "").trim().toLowerCase();
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  const adminEmail = adminGoogleEmail();
  if (adminEmail && lower === adminEmail) return true;
  const domains = allowedDomains();
  if (domains.length === 0) return true;
  const at = lower.split("@")[1];
  return Boolean(at && domains.includes(at));
}

export function allowedDomainsLabel(): string {
  const d = allowedDomains();
  if (d.length === 0) return "any email address";
  return d.map((x) => "@" + x).join(" or ");
}

// ------------------------------------------------------------
//  ID + password login - for anyone with a login created by
//  scripts/createAdminLogin.mjs (role: admin) or
//  scripts/createTeacherLogin.mjs (role: faculty). Not tied to any
//  real inbox, and more than one person can share the same admin
//  login if needed.
//
//  Firebase's email/password sign-in needs something email-shaped,
//  so a plain ID like "ashwin" gets turned into a fixed, made-up
//  address under this domain. Nobody needs to receive mail there -
//  it's just an identifier - and it's a fixed exact-match exception
//  in firestore.rules, not a whole open domain, so it can't be used
//  to sign up as anyone else.
// ------------------------------------------------------------

export const LOGIN_DOMAIN = "nst-room-board.internal";

export function idLoginEmail(id: string): string {
  const trimmed = id.trim().toLowerCase();
  // A real address (e.g. someone signing into their own Google-linked
  // account with a password set via `npm run set-password`) is used
  // as-is - only a bare id like "admin" gets the made-up domain
  // appended. Lets the same "Username & password" form serve both
  // synthetic ID logins AND a real account that also has Google
  // sign-in on it, without a second form.
  if (trimmed.includes("@")) return trimmed;
  return trimmed.replace(/\s+/g, "") + "@" + LOGIN_DOMAIN;
}

// ------------------------------------------------------------
//  Which domain means faculty, which means student.
//
//  Your campus splits cleanly: teachers sign in with a
//  @newtonschool.co address, students with @svyasa-sas.edu.in.
//  That split IS the role, so onboarding does not need to ask -
//  it detects the role from the email and locks it in. Nobody
//  types their own role, so nobody can pick the wrong one.
// ------------------------------------------------------------

function domainList(envVar: string | undefined): string[] {
  return (envVar || "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function facultyDomains(): string[] {
  return domainList(process.env.NEXT_PUBLIC_FACULTY_EMAIL_DOMAINS);
}

export function studentDomains(): string[] {
  return domainList(process.env.NEXT_PUBLIC_STUDENT_EMAIL_DOMAINS);
}

/**
 * Returns "faculty" or "student" if the email's domain is configured
 * as one or the other, else null - which means the onboarding screen
 * falls back to asking, so an unrecognised domain never gets stuck.
 */
export function roleForEmail(email: string | null | undefined): "faculty" | "student" | null {
  if (!email) return null;
  const domain = email.toLowerCase().split("@")[1];
  if (!domain) return null;
  if (facultyDomains().includes(domain)) return "faculty";
  if (studentDomains().includes(domain)) return "student";
  return null;
}

/**
 * A student's USN is the part of their college email before the "@"
 * (e.g. 2102508820@svyasa-sas.edu.in). Every 2nd-year USN given to us
 * starts "210" - anything else is 1st year. This lets onboarding know
 * a student's year with no dropdown and no roster row required, which
 * matters for 1st years since their name/batch list hasn't been
 * loaded yet. A roster entry's own `year` field always wins when one
 * exists - this is only the fallback for students not in the roster.
 */
export function yearFromUsn(email: string | null | undefined): number {
  const usn = (email || "").split("@")[0] || "";
  return usn.startsWith("210") ? 2 : 1;
}
