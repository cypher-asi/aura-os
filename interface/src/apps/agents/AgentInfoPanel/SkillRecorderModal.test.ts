import { describe, expect, it } from "vitest";
import { normalizeRecordedSkillName } from "./skill-recorder-utils";

describe("normalizeRecordedSkillName", () => {
  it("creates a bounded kebab-case skill slug", () => {
    expect(normalizeRecordedSkillName("  Publish Weekly Report!  ")).toBe(
      "publish-weekly-report",
    );
    expect(normalizeRecordedSkillName(`${"a".repeat(70)}---`)).toHaveLength(64);
  });
});
