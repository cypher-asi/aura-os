import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@cypher-asi/zui";
import { AppearanceSection } from "./AppearanceSection";

const TEST_STORAGE_KEY = "test-zui-theme";

function renderWithTheme(ui: ReactNode) {
  return render(
    <ThemeProvider
      defaultTheme="dark"
      defaultAccent="purple"
      storageKey={TEST_STORAGE_KEY}
    >
      {ui}
    </ThemeProvider>,
  );
}

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

describe("AppearanceSection", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
    mockMatchMedia(true);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders all three theme buttons and six accent swatches", () => {
    renderWithTheme(<AppearanceSection />);

    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();

    for (const label of ["Cyan", "Blue", "Purple", "Green", "Orange", "Rose"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("clicking Light updates <html> data-theme attribute to 'light'", async () => {
    const user = userEvent.setup();
    renderWithTheme(<AppearanceSection />);

    await user.click(screen.getByRole("button", { name: "Light" }));

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("clicking Light persists the theme choice to localStorage", async () => {
    const user = userEvent.setup();
    renderWithTheme(<AppearanceSection />);

    await user.click(screen.getByRole("button", { name: "Light" }));

    const stored = localStorage.getItem(TEST_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ theme: "light" });
  });

  it("clicking System resolves to the current system preference (dark)", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    renderWithTheme(<AppearanceSection />);

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");

    await user.click(screen.getByRole("button", { name: "System" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("clicking the rose accent swatch sets data-accent='rose' on <html>", async () => {
    const user = userEvent.setup();
    renderWithTheme(<AppearanceSection />);

    await user.click(screen.getByRole("button", { name: "Rose" }));

    expect(document.documentElement.dataset.accent).toBe("rose");
  });
});
