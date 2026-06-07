import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeView } from "./CodeView";

// Some shared components read `window.matchMedia` in mount effects
// (e.g. reduced-motion checks). JSDOM doesn't implement it, so install
// a minimal non-matching stub.
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
});

function renderCodeView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CodeView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  // Restore real timers in case a test installed `vi.useFakeTimers()`.
  vi.useRealTimers();
});

describe("CodeView", () => {
  it("streams the 'Code while you sleep.' hero headline via the typewriter", () => {
    // The hero headline renders through `<TypewriterText />`, which
    // reveals characters on a 45ms interval. The full literal string
    // only appears in the DOM after the interval has run for every
    // character. Advancing fake timers past that threshold flushes the
    // whole stream in a single `act()` tick.
    vi.useFakeTimers();
    renderCodeView();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole("heading", { name: /code while you sleep/i }),
    ).toBeInTheDocument();
  });

  it("renders the authenticated desktop-shell mock as its stage", () => {
    renderCodeView();
    // The `/code` stage is a faithful static mock of the authenticated
    // AURA desktop shell (titlebar + project sidebar + work surface +
    // sidekick + taskbar), not the landing's scripted DM windows.
    expect(screen.getByTestId("mock-aura-desktop")).toBeInTheDocument();
    expect(screen.queryByTestId("dm-window-manager")).not.toBeInTheDocument();
  });

  it("keeps the shared Download CTA footer linking to /download", () => {
    // `ChangelogPreview` is data-driven (renders nothing until its
    // React Query fetch resolves), so the always-present Download CTA
    // is the stable footer anchor to assert here. Match the CTA button
    // exactly ("Download") so it isn't confused with the footer's
    // "Downloads" resources link.
    renderCodeView();
    expect(
      screen.getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "/download");
  });
});
