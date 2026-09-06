// ============================================================
//  Firebase Admin setup (runs on the server only - the
//  /api/notify route). Never import this from a client component.
//
//  Credentials come from the service-account JSON you download in
//  Firebase console -> Project settings -> Service accounts.
// ============================================================

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cached: App | null = null;

export function adminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
}

function adminApp(): App {
  if (!adminConfigured()) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY."
    );
  }
  if (cached) return cached;

  const existing = getApps();
  if (existing.length) {
    cached = existing[0];
    return cached;
  }

  cached = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel stores the key with literal \n sequences; turn them back
      // into real newlines or the PEM parser rejects it.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
  return cached;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}
