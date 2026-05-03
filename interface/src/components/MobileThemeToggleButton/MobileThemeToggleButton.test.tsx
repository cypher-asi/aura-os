import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@cypher-asi/zui";
import { MobileThemeToggleButton } from "./MobileThemeToggleButton";

const TEST_STORAGE_KEY = "test-mobile-theme-toggle";

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? prefersDark : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderWithTheme(
  ui: ReactNode,
  { defaultTheme }: { defaultTheme: "dark" | "light" | "system" },
) {
  return render(
    <ThemeProvider defaultTheme={defaultTheme} storageKey={TEST_STORAGE_KEY}>
      {ui}
    </ThemeProvider>,
  );
}

describe("MobileThemeToggleButton", () => {
  beforeEach(() => {
    mockMatchMedia(true);
    window.localStorage.removeItem(TEST_STORAGE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.removeItem(TEST_STORAGE_KEY);
  });

  it("renders the correct icon for dark / light / system themes", () => {
    const { unmount: unmountDark } = renderWithTheme(<MobileThemeToggleButton />, {
      defaultTheme: "dark",
    });
    expect(screen.getByTestId("mobile-theme-toggle")).toHaveAttribute(
      "data-icon",
      "moon",
    );
    unmountDark();

    const { unmount: unmountLight } = renderWithTheme(<MobileThemeToggleButton />, {
      defaultTheme: "light",
    });
    expect(screen.getByTestId("mobile-theme-toggle")).toHaveAttribute(
      "data-icon",
      "sun",
    );
    unmountLight();

    renderWithTheme(<MobileThemeToggleButton />, { defaultTheme: "system" });
    expect(screen.getByTestId("mobile-theme-toggle")).toHaveAttribute(
      "data-icon",
      "system",
    );
  });

  it("cycles dark -> light -> system -> dark on successive clicks", () => {
    renderWithTheme(<MobileThemeToggleButton />, { defaultTheme: "dark" });
    const button = screen.getByTestId("mobile-theme-toggle");

    expect(button).toHaveAttribute("data-icon", "moon");

    fireEvent.click(button);
    expect(button).toHaveAttribute("data-icon", "sun");

    fireEvent.click(button);
    expect(button).toHaveAttribute("data-icon", "system");

    fireEvent.click(button);
    expect(button).toHaveAttribute("data-icon", "moon");
  });

  it("exposes an aria-label that reflects the current theme state", () => {
    renderWithTheme(<MobileThemeToggleButton />, { defaultTheme: "dark" });
    const button = screen.getByTestId("mobile-theme-toggle");

    expect(button).toHaveAttribute(
      "aria-label",
      "Switch theme (currently dark)",
    );

    fireEvent.click(button);
    expect(button).toHaveAttribute(
      "aria-label",
      "Switch theme (currently light)",
    );

    fireEvent.click(button);
    expect(button).toHaveAttribute(
      "aria-label",
      "Switch theme (currently system)",
    );
  });

  it("declares a 44x44 minimum touch target", () => {
    renderWithTheme(<MobileThemeToggleButton />, { defaultTheme: "dark" });
    const button = screen.getByTestId("mobile-theme-toggle");
    const computed = window.getComputedStyle(button);
    expect(computed.minWidth).toBe("44px");
    expect(computed.minHeight).toBe("44px");
  });
});
