// ============================================================
//  Small display-only helpers for showing a teacher's name.
// ============================================================

/**
 * The name exactly as it is stored on the profile - nothing added.
 *
 * This used to append "Sir" to any name that didn't already carry a
 * title, which meant guessing at how to address someone from their
 * name alone. It guessed wrong often enough (and for anyone who isn't
 * a "Sir" at all) that the whole idea is gone: whatever a person put
 * in their own profile is what the board shows.
 *
 * If a name still reads "… Mam" or "… Sir" on the board, that title
 * is part of the stored profile name itself, not added here - edit it
 * on the profile to change it.
 */
export function displayName(name: string): string {
  return (name || "").trim();
}
