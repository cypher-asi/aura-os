import { describe, expect, it } from "vitest";
import {
  isSessionSnoozed,
  resolveSessionSnoozePresets,
} from "./session-snooze";

describe("session snooze utilities", () => {
  it("resolves one-hour and next-morning presets", () => {
    const now = new Date(2026, 7, 30, 16, 15, 0, 0);
    const presets = resolveSessionSnoozePresets(now);
    expect(Date.parse(presets[0].snoozedUntil) - now.getTime()).toBe(
      60 * 60 * 1000,
    );
    const tomorrow = new Date(presets[1].snoozedUntil);
    expect(tomorrow.getDate()).toBe(new Date(2026, 7, 31).getDate());
    expect(tomorrow.getHours()).toBe(9);
  });

  it("treats invalid and expired timestamps as awake", () => {
    const now = Date.parse("2026-08-30T16:00:00Z");
    expect(isSessionSnoozed({ snoozed_until: "not-a-date" }, now)).toBe(false);
    expect(
      isSessionSnoozed({ snoozed_until: "2026-08-30T15:59:59Z" }, now),
    ).toBe(false);
    expect(
      isSessionSnoozed({ snoozed_until: "2026-08-30T16:00:01Z" }, now),
    ).toBe(true);
  });
});
