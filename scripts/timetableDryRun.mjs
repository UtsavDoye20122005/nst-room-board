#!/usr/bin/env node
// ============================================================
//  npm run timetable-dry-run
//
//  Reads both timetable Google Sheets and works out exactly what
//  the site would change - then writes NOTHING. Use it to see a
//  sheet edit's effect before letting it near the live board.
//
//  `npm run timetable-sync` is the same thing for real.
// ============================================================

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Lets this plain .mjs script import the app's own TypeScript, so
// the dry run exercises the SAME code the website runs rather than
// a second copy of it that could drift.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        try { return await next(spec, ctx); }
        catch (e) {
          if (spec.startsWith(".") || spec.startsWith("/")) {
            try { return await next(spec + ".ts", ctx); } catch {}
            try { return await next(spec + "/index.ts", ctx); } catch {}
          }
          throw e;
        }
      }
    `),
  import.meta.url
);

const { loadEnv, requireAdminEnv } = await import("./env.mjs");
loadEnv();
requireAdminEnv();

const here = pathToFileURL(process.cwd() + "/");
const { runTimetableSync } = await import(new URL("src/lib/timetable/sheetSync.ts", here).href);

const dryRun = !process.argv.includes("--write");

console.log(
  "\n  " + (dryRun ? "DRY RUN — nothing will be written." : "WRITING to " + process.env.FIREBASE_PROJECT_ID) + "\n"
);

const r = await runTimetableSync({ force: true, dryRun });

if (!r.ok) {
  console.error("  Failed: " + r.error + "\n");
  process.exit(1);
}

console.log("  Sessions read from the sheets : " + r.sessionsFound);
console.log("  Booked from                   : " + r.from + "  to  " + r.to);
console.log("  Would add                     : " + r.created);
console.log("  Would change                  : " + r.updated);
console.log("  Would remove                  : " + r.removed);

if (r.displaced.length) {
  console.log("\n  Teachers' own bookings that would be cancelled (the sheet needs the room):");
  r.displaced.forEach((d) => console.log("    - " + d));
}
if (r.problems.length) {
  console.log("\n  Rows on the sheets that could not be placed:");
  r.problems.forEach((p) => console.log("    ! " + p));
}
console.log(
  "\n  " + (dryRun ? "Nothing was written. Re-run with --write to apply." : "Done.") + "\n"
);
process.exit(0);
