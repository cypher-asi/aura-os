import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@cypher-asi/zui";
import { CustomTokensPanel } from "./CustomTokensPanel";

const TEST_STORAGE_KEY = "test-zui-theme";
const OVERRIDES_KEY = "aura-theme-overrides";

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

describe("CustomTokensPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
    mockMatchMedia(true);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    vi.unstubAllGlobals();
  });

  it("renders a row for every editable token", () => {
    renderWithTheme(<CustomTokensPanel />);
    for (const label of [
      "Border",
      "Surface tint",
      "Elevated tint",
      "Sidebar background",
      "Sidekick background",
      "Titlebar background",
      "Accent",
    ]) {
      expect(
        screen.getByRole("textbox", { name: `${label} CSS value` }),
      ).toBeInTheDocument();
    }
  });

  it("typing a valid CSS value applies it as an inline style and persists it", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CustomTokensPanel />);

    const input = screen.getByRole("textbox", { name: "Border CSS value" });
    await user.clear(input);
    await user.type(input, "#abcdef");

    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#abcdef");
    const stored = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}");
    expect(stored.dark["--color-border"]).toBe("#abcdef");
  });

  it("typing an invalid CSS value flags the input and does NOT apply it", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CustomTokensPanel />);

    const input = screen.getByRole("textbox", { name: "Border CSS value" });
    await user.clear(input);
    await user.type(input, "not-a-color-123");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
  });

  it("the color picker change sets the token", () => {
    renderWithTheme(<CustomTokensPanel />);
    const picker = screen.getByLabelText("Border color picker");
    // userEvent doesn't drive <input type="color"> natively; fireEvent.change
    // goes through React's value tracker and invokes the onChange handler.
    fireEvent.change(picker, { target: { value: "#112233" } });

    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#112233");
  });

  it("reset button on a row clears that token only", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      OVERRIDES_KEY,
      JSON.stringify({
        dark: {
          "--color-border": "#111111",
          "--color-sidebar-bg": "#222222",
        },
        light: {},
      }),
    );

    renderWithTheme(<CustomTokensPanel />);

    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#111111");

    await user.click(screen.getByRole("button", { name: "Reset Border" }));

    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--color-sidebar-bg"),
    ).toBe("#222222");
  });

  it("Reset all clears every override for the current theme", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      OVERRIDES_KEY,
      JSON.stringify({
        dark: {
          "--color-border": "#111111",
          "--color-sidebar-bg": "#222222",
        },
        light: { "--color-border": "#eeeeee" },
      }),
    );

    renderWithTheme(<CustomTokensPanel />);

    const panel = screen.getByTestId("custom-tokens-panel");
    await user.click(within(panel).getByRole("button", { name: "Reset all" }));

    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--color-sidebar-bg"),
    ).toBe("");
    const stored = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}");
    expect(stored.dark).toEqual({});
    expect(stored.light).toEqual({ "--color-border": "#eeeeee" });
  });
});
