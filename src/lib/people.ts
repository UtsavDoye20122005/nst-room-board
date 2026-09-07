// ============================================================
//  Small display-only helpers for showing a teacher's name.
// ============================================================

/**
 * "Pranav" -> "Pranav Sir", "Soumya" -> "Soumya Sir" (wrong - so name
 * her "Soumya Mam" wherever it's set, and this leaves it alone).
 *
 * Skips anyone who already carries a title (covers "mam" as well as
 * "ma'am"/"maam"/"madam"), skips labels that aren't a person at all
 * (e.g. "Exam Cell" for a CONTEST booking), and skips the shared admin
 * account, which isn't a person - "Exam Cell Sir" or "Admin Sir" would
 * just look wrong. Safe to call on a name that already has an
 * honorific baked in (most seeded teachers do, since nothing else
 * adds it automatically anymore) - it's a no-op for those.
 */
export function withHonorific(name: string): string {
  const n = (name || "").trim();
  if (
    !n ||
    /\b(sir|ma'?am|mam|madam)\b/i.test(n) ||
    /\b(cell|committee|office|department|board)\b/i.test(n) ||
    /^admin$/i.test(n)
  ) {
    return n;
  }
  return n + " Sir";
}
