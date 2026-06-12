import type { PersonalityPreset } from "../onboarding-data";

/**
 * Pick a personality preset different from the current one. Pure + the RNG is
 * injectable so the "Generate" behaviour is deterministic under test.
 */
export function pickRandomPersonality(
  presets: readonly PersonalityPreset[],
  currentDescription: string,
  rng: () => number = Math.random,
): PersonalityPreset | null {
  if (presets.length === 0) return null;
  const others = presets.filter((p) => p.description !== currentDescription);
  const pool = others.length > 0 ? others : presets;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[index];
}
