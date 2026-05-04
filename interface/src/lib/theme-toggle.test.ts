import { describe, expect, it } from "vitest";
import type { ResolvedTheme, Theme } from "@cypher-asi/zui";
import {
  cycleTheme,
  getThemeToggleAriaLabel,
  getThemeToggleIconKind,
  type ThemeToggleIconKind,
} from "./theme-toggle";

describe("cycleTheme", () => {
  const cases: Array<{
    from: Theme;
    resolved: ResolvedTheme;
    to: Theme;
  }> = [
    { from: "dark", resolved: "dark", to: "light" },
    { from: "light", resolved: "light", to: "dark" },
    // From "system" we resolve to the OPPOSITE of what's currently
    // painted so the click always produces a visible change.
    { from: "system", resolved: "dark", to: "light" },
    { from: "system", resolved: "light", to: "dark" },
  ];

  for (const { from, resolved, to } of cases) {
    it(`cycles ${from} (resolved=${resolved}) -> ${to}`, () => {
      expect(cycleTheme(from, resolved)).toBe(to);
    });
  }

  it("toggles back and forth between dark and light", () => {
    expect(cycleTheme(cycleTheme("dark", "dark"), "light")).toBe("dark");
  });
});

describe("getThemeToggleIconKind", () => {
  const cases: Array<{
    theme: Theme;
    resolvedTheme: ResolvedTheme;
    expected: ThemeToggleIconKind;
  }> = [
    { theme: "dark", resolvedTheme: "dark", expected: "moon" },
    { theme: "light", resolvedTheme: "light", expected: "sun" },
    // `system` resolves to whichever of light/dark is currently painted
    // — the icon mirrors what the user actually sees.
    { theme: "system", resolvedTheme: "dark", expected: "moon" },
    { theme: "system", resolvedTheme: "light", expected: "sun" },
  ];

  for (const { theme, resolvedTheme, expected } of cases) {
    it(`theme=${theme} resolved=${resolvedTheme} -> ${expected}`, () => {
      expect(getThemeToggleIconKind(theme, resolvedTheme)).toBe(expected);
    });
  }
});

describe("getThemeToggleAriaLabel", () => {
  const cases: Array<{
    theme: Theme;
    resolvedTheme: ResolvedTheme;
    expected: string;
  }> = [
    { theme: "dark", resolvedTheme: "dark", expected: "Switch theme (currently dark)" },
    { theme: "light", resolvedTheme: "light", expected: "Switch theme (currently light)" },
    { theme: "system", resolvedTheme: "dark", expected: "Switch theme (currently dark)" },
    { theme: "system", resolvedTheme: "light", expected: "Switch theme (currently light)" },
  ];

  for (const { theme, resolvedTheme, expected } of cases) {
    it(`theme=${theme} resolved=${resolvedTheme} -> "${expected}"`, () => {
      expect(getThemeToggleAriaLabel(theme, resolvedTheme)).toBe(expected);
    });
  }
});
