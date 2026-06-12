import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// Global i18n stub. The real i18next instance loads locale JSON via async
// dynamic imports, which would force every translated component to suspend in
// jsdom. Tests only care about copy, so resolve `t(key, { defaultValue })`
// to the English default (or the key) synchronously. Applied from a setup
// file, this mock is shared by every test file.
vi.mock("react-i18next", () => {
  const t = (key: string, options?: Record<string, unknown>): string => {
    if (options && typeof options.defaultValue === "string") {
      return options.defaultValue;
    }
    return key;
  };
  return {
    useTranslation: () => ({
      t,
      i18n: { language: "en", changeLanguage: () => Promise.resolve() },
    }),
    Trans: ({ children }: { children?: unknown }) => children ?? null,
    I18nextProvider: ({ children }: { children?: unknown }) => children ?? null,
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

// Defense-in-depth against Node's experimental Web Storage global (Node 23+).
// vitest.config.ts already passes `--no-experimental-webstorage` to the fork
// workers, but if the pool type or the flag name changes, Node's storage stub
// (method-less without `--localstorage-file`) would silently shadow jsdom's
// implementation again. If `localStorage` is missing or broken, install a
// real in-memory Storage so tests behave the same everywhere.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  const existing = (globalThis as Record<string, unknown>)[name] as
    | Storage
    | undefined;
  if (typeof existing?.getItem !== "function") {
    Object.defineProperty(globalThis, name, {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

// JSDOM lacks ResizeObserver. Several layout-driven components (ModeSelector,
// DesktopShell, sidekick scrollbar, etc.) rely on it at mount time, so any
// consumer test that doesn't otherwise mock it would crash on render. Provide
// an inert global no-op so these tests can render without each having to
// install its own mock.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

