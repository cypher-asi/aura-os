import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@cypher-asi/zui";
import { PresetsPanel } from "./PresetsPanel";

const TEST_STORAGE_KEY = "test-zui-theme";
const PRESETS_KEY = "aura-theme-presets";

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

describe("PresetsPanel", () => {
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
    vi.restoreAllMocks();
  });

  it("renders the working set option and the matching built-in preset", () => {
    renderWithTheme(<PresetsPanel />);
    const select = screen.getByTestId("preset-select") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(labels).toContain("(working set)");
    expect(labels.some((l) => l.includes("Aura Dark"))).toBe(true);
    expect(select.value).toBe("");
  });

  it("Save as preset flow snapshots the working set and selects the new preset", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(userId);
    const user = userEvent.setup();
    renderWithTheme(<PresetsPanel />);

    await user.click(screen.getByRole("button", { name: "Save as preset" }));
    const input = screen.getByLabelText("New preset name");
    await user.type(input, "My Theme");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const select = screen.getByTestId("preset-select") as HTMLSelectElement;
    expect(select.value).toBe(userId);
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    expect(stored.active.dark).toBe(userId);
  });

  it("changing the select to a built-in marks it active", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PresetsPanel />);

    const select = screen.getByTestId("preset-select") as HTMLSelectElement;
    await user.selectOptions(select, "aura-dark");

    expect(select.value).toBe("aura-dark");
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    expect(stored.active.dark).toBe("aura-dark");
  });

  it("Rename and Delete are disabled when only the working set or a built-in is active", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PresetsPanel />);

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

    const select = screen.getByTestId("preset-select") as HTMLSelectElement;
    await user.selectOptions(select, "aura-dark");

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("Rename flow updates the active user preset's name", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(userId);
    const user = userEvent.setup();
    renderWithTheme(<PresetsPanel />);

    await user.click(screen.getByRole("button", { name: "Save as preset" }));
    await user.type(screen.getByLabelText("New preset name"), "Original");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const renameInput = screen.getByLabelText("Rename preset");
    await user.clear(renameInput);
    await user.type(renameInput, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    const target = (stored.presets as Array<{ id: string; name: string }>).find(
      (p) => p.id === userId,
    );
    expect(target?.name).toBe("Renamed");
  });

  it("Delete asks for confirmation and removes the preset on accept", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(userId);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderWithTheme(<PresetsPanel />);

    await user.click(screen.getByRole("button", { name: "Save as preset" }));
    await user.type(screen.getByLabelText("New preset name"), "Disposable");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete preset "Disposable"?');
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    const remaining = (stored.presets as Array<{ id: string }>).find(
      (p) => p.id === userId,
    );
    expect(remaining).toBeUndefined();
    expect(stored.active.dark).toBeNull();
  });

  it("Delete is a no-op when the user cancels the confirm dialog", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(userId);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderWithTheme(<PresetsPanel />);

    await user.click(screen.getByRole("button", { name: "Save as preset" }));
    await user.type(screen.getByLabelText("New preset name"), "Disposable");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    const remaining = (stored.presets as Array<{ id: string }>).find(
      (p) => p.id === userId,
    );
    expect(remaining).toBeDefined();
  });

  it("Export triggers a JSON download for the active preset", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(userId);
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    );
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        const el = originalCreate(tag, options);
        if (tag === "a") {
          el.click = clickSpy;
        }
        return el;
      },
    );

    const user = userEvent.setup();
    renderWithTheme(<PresetsPanel />);

    await user.click(screen.getByRole("button", { name: "Save as preset" }));
    await user.type(screen.getByLabelText("New preset name"), "Exportable");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("Export is disabled when no preset is active", () => {
    renderWithTheme(<PresetsPanel />);
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("Import success adds the preset and shows a success indicator", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "22222222-2222-2222-2222-222222222222",
    );
    const json = JSON.stringify(
      {
        id: "ignored",
        name: "Shared",
        base: "dark",
        overrides: { "--color-border": "#abcdef" },
        version: 1,
      },
      null,
      2,
    );
    const file = new File([json], "shared.json", { type: "application/json" });

    renderWithTheme(<PresetsPanel />);

    const fileInput = screen.getByTestId(
      "preset-import-file",
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText(/Imported/i)).toBeInTheDocument();
    });
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    const imported = (
      stored.presets as Array<{ id: string; overrides: Record<string, string> }>
    ).find((p) => p.id === "22222222-2222-2222-2222-222222222222");
    expect(imported?.overrides["--color-border"]).toBe("#abcdef");
  });

  it("Import failure shows the reason as inline error text", async () => {
    const file = new File(["{not valid"], "broken.json", {
      type: "application/json",
    });

    renderWithTheme(<PresetsPanel />);

    const fileInput = screen.getByTestId(
      "preset-import-file",
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
    });
  });
});
