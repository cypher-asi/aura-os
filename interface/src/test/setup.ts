import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
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
