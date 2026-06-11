import { describe, expect, it } from "vitest";
import { pickRandomPersonality } from "./IdentityStep";
import { PERSONALITY_PRESETS } from "../onboarding-data";

describe("pickRandomPersonality", () => {
  it("returns a preset different from the current one when possible", () => {
    const current = PERSONALITY_PRESETS[0].description;
    const next = pickRandomPersonality(PERSONALITY_PRESETS, current, () => 0);
    expect(next).not.toBeNull();
    expect(next?.description).not.toBe(current);
  });

  it("falls back to the full pool when nothing matches the current value", () => {
    const next = pickRandomPersonality(PERSONALITY_PRESETS, "not-a-real-personality", () => 0);
    expect(next).toBe(PERSONALITY_PRESETS[0]);
  });

  it("returns null for an empty preset list", () => {
    expect(pickRandomPersonality([], "", () => 0)).toBeNull();
  });
});
