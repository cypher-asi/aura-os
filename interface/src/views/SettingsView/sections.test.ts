import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  isSettingsSectionId,
} from "./sections";

describe("settings sections", () => {
  it("registers the expected ids in order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "about",
      "appearance",
      "notifications",
      "keyboard",
      "advanced",
    ]);
  });

  it("exposes a default section that exists in the list", () => {
    expect(SETTINGS_SECTIONS.some((s) => s.id === DEFAULT_SETTINGS_SECTION)).toBe(true);
  });

  it("isSettingsSectionId accepts every registered id", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(isSettingsSectionId(section.id)).toBe(true);
    }
  });

  it("isSettingsSectionId rejects unknown ids", () => {
    expect(isSettingsSectionId("not-a-section")).toBe(false);
    expect(isSettingsSectionId("")).toBe(false);
    expect(isSettingsSectionId("ABOUT")).toBe(false);
  });
});
