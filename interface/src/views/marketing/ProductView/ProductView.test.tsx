import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PERSONAS } from "../../public-chat/personas";
import { ProductView } from "./ProductView";

// `ProductScreenSection` calls `window.matchMedia("(prefers-reduced-motion:
// reduce)")` inside its mount effect to decide between the animated lightbox
// transition and a no-op. JSDOM does not implement `matchMedia`, so we install
// a minimal stub before any component mounts. The stub returns a non-matching
// `MediaQueryList`-shaped object and ignores listener registration; the
// production code only reads `matches` and calls `addEventListener` /
// `removeEventListener` (with legacy `addListener` / `removeListener`
// fallbacks).
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

function renderProductView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ProductView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  // Restore real timers in case a test installed `vi.useFakeTimers()`.
  // Tests that need fake timers opt in per-test; the reset keeps that
  // opt-in from leaking into subsequent suites if a new test forgets
  // to clean up after itself.
  vi.useRealTimers();
});

describe("ProductView", () => {
  it("streams the 'Delegate everything.' hero headline via the typewriter", () => {
    // The hero headline renders through `<TypewriterText />`, which
    // reveals characters on a 45ms interval. The full literal string
    // only appears in the DOM after the interval has run for every
    // character. Advancing fake timers past that threshold flushes the
    // whole stream in a single `act()` tick.
    vi.useFakeTimers();
    renderProductView();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Delegate everything.")).toBeInTheDocument();
  });

  it("keeps the AgentChatSection and moves the product-screen rows to the Code page", () => {
    // The agent-chat section stays on the Agents page (anchoring the
    // mobile-experience story after the hero). The four
    // `ProductScreenSection` rows — led by "A secure operating
    // system..." — were split out to `CodeView` (`/code`), so they
    // must NOT render here anymore.
    renderProductView();
    expect(
      screen.getByRole("heading", { name: /Chat with your agents/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /A secure operating system/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the personal-agent section after the agents hero", () => {
    // The "An agent for work, love, play." section is inserted after
    // the agents hero/card row, so its headline must precede the
    // agent-chat section's headline in DOM order.
    renderProductView();
    const personalAgent = screen.getByRole("heading", {
      name: /An agent for work, love, play\./i,
    });
    const agentChat = screen.getByRole("heading", {
      name: /Chat with your agents/i,
    });
    expect(
      personalAgent.compareDocumentPosition(agentChat) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Temporarily skipped: the `<AgentOrbSection />` (orb + agent marquee)
  // is commented out of `ProductView` for now, so the marquee no longer
  // renders here. Re-enable this test when the section is restored.
  it.skip("mounts the agent marquee in the orb section with one card per persona", () => {
    // The orb + agent marquee moved out of the hero into the
    // standalone `<AgentOrbSection />` (below the agent-chat section),
    // so the strip should still be present on the rendered ProductView.
    // The marquee duplicates the persona list for the seamless wrap, so
    // we assert at least one card per persona renders (the duplicate
    // count is covered explicitly in `AgentMarquee.test.tsx` —
    // duplicating the assertion here would make a future loop-strategy
    // tweak fail in two places at once for the same reason).
    renderProductView();
    const marquee = screen.getByTestId("agent-marquee");
    for (const persona of PERSONAS) {
      const cards = within(marquee).getAllByRole("img", {
        name: `${persona.name}, ${persona.role}`,
      });
      expect(cards.length).toBeGreaterThanOrEqual(1);
    }
  });
});