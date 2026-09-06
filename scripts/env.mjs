// Tiny .env.local reader so the scripts need no extra dependency.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(file = ".env.local") {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    console.error("\n  Could not find " + file + " in " + process.cwd());
    console.error("  Copy .env.local.example to .env.local and fill it in first.\n");
    process.exit(1);
  }

  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireAdminEnv() {
  const missing = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    console.error("\n  Missing in .env.local: " + missing.join(", "));
    console.error("  Get these from Firebase console -> Project settings -> Service accounts");
    console.error("  -> Generate new private key, then copy the values across.\n");
    process.exit(1);
  }
}
