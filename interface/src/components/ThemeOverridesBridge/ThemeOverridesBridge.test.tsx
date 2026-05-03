import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTheme } from "@cypher-asi/zui";
import { ThemeOverridesBridge } from "./ThemeOverridesBridge";

const STORAGE_KEY = "aura-theme-overrides";

const useThemeMock = vi.fn<() => { resolvedTheme: ResolvedTheme }>();

vi.mock("@cypher-asi/zui", () => ({
  useTheme: () => useThemeMock(),
}));

describe("ThemeOverridesBridge", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    useThemeMock.mockReset();
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("renders nothing", () => {
    const { container } = render(<ThemeOverridesBridge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("applies persisted overrides for the current resolved theme on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-sidebar-bg": "#121212" },
        light: { "--color-sidebar-bg": "#fafafa" },
      }),
    );

    render(<ThemeOverridesBridge />);

    expect(
      document.documentElement.style.getPropertyValue("--color-sidebar-bg"),
    ).toBe("#121212");
  });

  it("re-applies overrides when resolved theme flips", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-sidebar-bg": "#121212" },
        light: { "--color-sidebar-bg": "#fafafa" },
      }),
    );
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    const { rerender } = render(<ThemeOverridesBridge />);
    expect(
      document.documentElement.style.getPropertyValue("--color-sidebar-bg"),
    ).toBe("#121212");

    useThemeMock.mockReturnValue({ resolvedTheme: "light" });
    rerender(<ThemeOverridesBridge />);

    expect(
      document.documentElement.style.getPropertyValue("--color-sidebar-bg"),
    ).toBe("#fafafa");
  });
});
