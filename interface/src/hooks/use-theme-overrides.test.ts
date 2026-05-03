import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTheme } from "@cypher-asi/zui";
import { useThemeOverrides } from "./use-theme-overrides";

const STORAGE_KEY = "aura-theme-overrides";

const useThemeMock = vi.fn<() => { resolvedTheme: ResolvedTheme }>();

vi.mock("@cypher-asi/zui", () => ({
  useTheme: () => useThemeMock(),
}));

describe("useThemeOverrides", () => {
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

  it("hydrates the active override set from localStorage on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#ff0000" },
        light: { "--color-border": "#0000ff" },
      }),
    );

    const { result } = renderHook(() => useThemeOverrides());

    expect(result.current.overrides).toEqual({ "--color-border": "#ff0000" });
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#ff0000");
  });

  it("setToken persists the override and writes the inline style", () => {
    const { result } = renderHook(() => useThemeOverrides());

    act(() => {
      result.current.setToken("--color-border", "#123456");
    });

    expect(result.current.overrides["--color-border"]).toBe("#123456");
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#123456");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({
      dark: { "--color-border": "#123456" },
      light: {},
    });
  });

  it("setToken with null clears the override and removes the inline style", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#abcdef" },
        light: {},
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#abcdef");

    act(() => {
      result.current.setToken("--color-border", null);
    });

    expect(result.current.overrides["--color-border"]).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.dark).toEqual({});
  });

  it("resetAll clears the active resolvedTheme and leaves the other alone", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#111111" },
        light: { "--color-border": "#eeeeee" },
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());

    act(() => {
      result.current.resetAll();
    });

    expect(result.current.overrides).toEqual({});
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({
      dark: {},
      light: { "--color-border": "#eeeeee" },
    });
  });

  it("re-applies the matching side when resolvedTheme changes", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#111111" },
        light: { "--color-border": "#eeeeee" },
      }),
    );
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    const { result, rerender } = renderHook(() => useThemeOverrides());

    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#111111");

    useThemeMock.mockReturnValue({ resolvedTheme: "light" });
    rerender();

    expect(result.current.overrides).toEqual({ "--color-border": "#eeeeee" });
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#eeeeee");
  });
});
