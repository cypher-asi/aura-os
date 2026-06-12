import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// `ModelMarquee` (inside `PersonalAgentSection`) imports provider marks
// from `@lobehub/icons`, whose ESM build does a directory import of
// `@lobehub/fluent-emoji` that Node's ESM resolver rejects under
// Vitest. Stub the ten marks the marquee/device textures use; the
// tests only care about surrounding layout, not the brand SVGs.
vi.mock("@lobehub/icons", () => {
  const Icon = ({ size }: { size?: number }) => (
    <span data-testid="provider-icon-stub" data-size={size} />
  );
  return {
    Anthropic: Icon,
    ByteDance: Icon,
    DeepSeek: Icon,
    Gemini: Icon,
    Minimax: Icon,
    Moonshot: Icon,
    OpenAI: Icon,
    Qwen: Icon,
    Tripo: Icon,
    ZAI: Icon,
  };
});

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
  it("streams the 'Work while you sleep.' hero headline via the typewriter", () => {
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
    expect(screen.getByText("Work while you sleep.")).toBeInTheDocument();
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
    // The "Every model. Every mode." section is inserted after the
    // agents hero/card row, so its headline must precede the
    // agent-chat section's headline in DOM order.
    renderProductView();
    const personalAgent = screen.getByRole("heading", {
      name: /Every model\. Every mode\./i,
    });
    const agentChat = screen.getByRole("heading", {
      name: /Chat with your agents/i,
    });
    expect(
      personalAgent.compareDocumentPosition(agentChat) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

});