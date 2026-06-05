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

