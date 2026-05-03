import { describe, expect, it } from "vitest";
import type { ResolvedTheme, Theme } from "@cypher-asi/zui";
import {
  cycleTheme,
  getThemeToggleAriaLabel,
  getThemeToggleIconKind,
  type ThemeToggleIconKind,
} from "./theme-toggle";

describe("cycleTheme", () => {
  const cases: Array<{ from: Theme; to: Theme }> = [
    { from: "dark", to: "light" },
    { from: "light", to: "system" },
    { from: "system", to: "dark" },
  ];

  for (const { from, to } of cases) {
    it(`cycles ${from} -> ${to}`, () => {
      expect(cycleTheme(from)).toBe(to);
    });
  }

  it("returns to dark after three steps", () => {
    expect(cycleTheme(cycleTheme(cycleTheme("dark")))).toBe("dark");
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
    { theme: "system", resolvedTheme: "dark", expected: "system" },
    { theme: "system", resolvedTheme: "light", expected: "system" },
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
    {
      theme: "system",
      resolvedTheme: "dark",
      expected: "Switch theme (currently system)",
    },
    {
      theme: "system",
      resolvedTheme: "light",
      expected: "Switch theme (currently system)",
    },
  ];

  for (const { theme, resolvedTheme, expected } of cases) {
    it(`theme=${theme} resolved=${resolvedTheme} -> "${expected}"`, () => {
      expect(getThemeToggleAriaLabel(theme, resolvedTheme)).toBe(expected);
    });
  }
});
