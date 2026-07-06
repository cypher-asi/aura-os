/**
 * Behavioural test for `PublicChatView`'s public chat layout.
 *
 * The public surface keeps the decorative `MockAuraApp` frame and
 * persona controls, then mounts a simple transcript + input on
 * `/chat`. These tests pin that contract and the persona-theme swap
 * wiring.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamPublicChatMock, setupPublicSessionMock } = vi.hoisted(() => ({
  streamPublicChatMock: vi.fn(),
  setupPublicSessionMock: vi.fn(),
}));

vi.mock("../../../api/public-chat", () => ({
  streamPublicChat: streamPublicChatMock,
  setupPublicSession: setupPublicSessionMock,
  isGuestAuthError: (err: unknown) =>
    err instanceof Error && err.message.toLowerCase().includes("guest token"),
}));

// Stub `MockAuraApp` so the test surfaces just the wallpaper-prop
// contract — the real component pulls in the scripted DM windows
// and full chrome that these chat-surface tests don't need to exercise.
// The stub echoes BOTH the current desktop bg URL AND the
// outgoing snapshot's URL into data attributes so the layered
// cross-fade is observable, plus the current `activePersonaIndex`
// so we can pin that the bottom-left avatar dock and the right-
// edge `PersonaTickRail` share one piece of state. A pair of
// hidden click targets simulate the dock firing
// `onPersonaSelect(1)` / `onPersonaSelect(2)` without pulling
// the real avatar buttons in.
vi.mock("../MockAuraApp", () => ({
  MockAuraApp: ({
    desktopBackgroundUrl,
    outgoingDesktopBackground,
    activePersonaIndex,
    onPersonaSelect,
  }: {
    desktopBackgroundUrl?: string | null;
    outgoingDesktopBackground?: {
      readonly url: string | null;
      readonly fadeKey: number;
    } | null;
    activePersonaIndex?: number;
    onPersonaSelect?: (index: number) => void;
  }) => (
    <div
      data-testid="mock-aura-app-stub"
      data-desktop-bg={desktopBackgroundUrl ?? ""}
      data-outgoing-desktop-bg={outgoingDesktopBackground?.url ?? ""}
      data-outgoing-fade-key={
        outgoingDesktopBackground?.fadeKey != null
          ? String(outgoingDesktopBackground.fadeKey)
          : ""
      }
      data-active-persona-index={
        activePersonaIndex != null ? String(activePersonaIndex) : ""
      }
    >
      <button
        type="button"
        data-testid="mock-aura-app-dock-select-vibecoder"
        onClick={() => onPersonaSelect?.(1)}
      />
      <button
        type="button"
        data-testid="mock-aura-app-dock-select-solo-builder"
        onClick={() => onPersonaSelect?.(2)}
      />
    </div>
  ),
}));

// Stub the embedded `/agents` section stack (lazy-loaded below the
// landing hero). The real component pulls in the entire marketing
// page — AgentConsole timers, WebGL devices, media — none of which
// these layout/carousel tests exercise. The stub keeps the scroll
// column's second child present so scroll geometry assertions stay
// meaningful.
vi.mock("../../marketing/ProductView/AgentsPageSections", () => {
  const AgentsPageSectionsStub = () => (
    <div data-testid="agents-embed-stub" />
  );
  return {
    AgentsPageSections: AgentsPageSectionsStub,
    default: AgentsPageSectionsStub,
  };
});

import { PublicChatView } from "./PublicChatView";
import { usePublicChatStore } from "../../../stores/public-chat-store";

function renderView(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PublicChatView />
    </MemoryRouter>,
  );
}

/**
 * Echoes the current router location into the DOM so navigation
 * effects triggered by the CTA can be asserted without coupling
 * the test to React Router internals.
 */
function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
    />
  );
}

function renderViewWithProbe(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<PublicChatView />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Tick buttons live inside the `<ul aria-label="Agent personas">`. */
function tickFor(name: string): HTMLElement {
  const list = screen.getByLabelText("Agent personas");
  return within(list).getByRole("button", { name });
}

/**
 * Panel rows live inside the open/close menu panel. The panel
 * carries `aria-hidden="true"` while closed (screen readers reach
 * personas via the tick buttons instead), so the query opts into
 * hidden elements to keep the helper usable in both states.
 */
function panelFor(name: string): HTMLElement {
  const panel = screen.getByTestId("persona-tick-rail-panel");
  return within(panel).getByRole("button", { name, hidden: true });
}

beforeEach(() => {
  window.localStorage.clear();
  streamPublicChatMock.mockImplementation(
    (args: { onDelta: (text: string) => void; onDone?: () => void }) => {
      args.onDelta("Hello from Aura");
      args.onDone?.();
      return { close: vi.fn() };
    },
  );
  setupPublicSessionMock.mockReset();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: "guest-token",
    setupInFlight: false,
  });
});

afterEach(() => {
  window.localStorage.clear();
  streamPublicChatMock.mockReset();
  setupPublicSessionMock.mockReset();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
    setupInFlight: false,
  });
});

describe("PublicChatView", () => {
  it("renders the MockAuraApp hero inside the empty-state region", () => {
    renderView();
    expect(screen.getByTestId("mock-aura-app-stub")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Start a new conversation" }),
    ).toBeInTheDocument();
  });

  it("renders chat-first public landing CTAs", () => {
    renderView();
    expect(screen.getByRole("button", { name: /start chatting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get aura desktop/i })).toBeInTheDocument();
  });

  it("navigates to public chat when Start chatting is clicked", () => {
    renderViewWithProbe();
    const probe = screen.getByTestId("location-probe");
    expect(probe).toHaveAttribute("data-pathname", "/");
    expect(probe).toHaveAttribute("data-search", "");

    fireEvent.click(
      screen.getByRole("button", { name: /start chatting/i }),
    );

    expect(probe).toHaveAttribute("data-pathname", "/chat");
    expect(probe).toHaveAttribute("data-search", "");
  });

  it("routes the public Desktop handoff to the download path", () => {
    renderViewWithProbe();
    const probe = screen.getByTestId("location-probe");

    fireEvent.click(
      screen.getByRole("button", { name: /get aura desktop/i }),
    );

    expect(probe).toHaveAttribute("data-pathname", "/download");
  });

  it("shows the simple chat input on /chat WITHOUT auto-minting a session", async () => {
    // Landing on `/chat` no longer auto-mints a session — the
    // composer renders in its empty state and the first
    // `handleSubmit` is what creates the session row. Pinning this
    // here so the delete flow (`PublicSessionsPanel.handleDelete`)
    // can land the visitor on a session-less `/chat` without
    // spawning a fresh "New chat" on top of the one they just
    // removed.
    renderViewWithProbe("/chat");

    expect(
      await screen.findByRole("textbox", { name: "Message Aura" }),
    ).toBeInTheDocument();

    // Give a microtask + macrotask for any stray effect to flush.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(usePublicChatStore.getState().sessionOrder).toHaveLength(0);
    expect(screen.getByTestId("location-probe")).toHaveAttribute(
      "data-pathname",
      "/chat",
    );
    expect(screen.getByTestId("location-probe")).toHaveAttribute(
      "data-search",
      "",
    );
  });

  it("auto-focuses the chat input when landing on /chat", async () => {
    // Arriving on /chat (whether from the sidebar's Chat link, a
    // session row click, or a direct visit) must place the cursor
    // inside the message input so the visitor can start typing
    // without a manual click. The composer form unmounts on the
    // landing surface and re-mounts on /chat, so React's autoFocus
    // fires exactly once per arrival.
    renderView("/chat");

    const input = await screen.findByRole("textbox", { name: "Message Aura" });
    expect(input).toHaveFocus();
  });

  /*
   * The decorative `MockAuraApp` hero and the right-edge persona
   * `PersonaTickRail` are landing-only chrome. On `/chat` the visitor
   * is focused on talking to Aura, so both unmount entirely — the
   * chat surface, input bar, and persona page background own the
   * visual field without the demo desktop dominating the foreground
   * or the tick column distracting from the transcript. Pinned via
   * the two test ids the rest of the suite already uses for these
   * surfaces, so a regression that leaves either visible on the
   * chat page would also flip this assertion.
   */
  it("hides the MockAuraApp hero AND the persona tick rail on /chat", async () => {
    renderView("/chat");

    // Sanity: the chat input does render (proves we're really on the
    // chat surface and not a route-mismatch false-negative).
    expect(
      await screen.findByRole("textbox", { name: "Message Aura" }),
    ).toBeInTheDocument();

    expect(screen.queryByTestId("mock-aura-app-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("persona-tick-rail")).not.toBeInTheDocument();
  });

  it("renders the selected public chat transcript", () => {
    let sessionId = "";
    act(() => {
      sessionId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(sessionId, "hello aura");
      usePublicChatStore
        .getState()
        .appendAssistantToken(sessionId, "assistant-1", "hello human", "code");
      usePublicChatStore.getState().commitAssistant(sessionId, "assistant-1");
    });

    renderView(`/chat?session=${sessionId}`);

    expect(screen.getByText("hello aura")).toBeInTheDocument();
    expect(screen.getByText("hello human")).toBeInTheDocument();
  });

  it("sends a public chat turn through the existing stream client", async () => {
    const user = userEvent.setup();
    let sessionId = "";
    act(() => {
      sessionId = usePublicChatStore.getState().createSession();
    });
    renderView(`/chat?session=${sessionId}`);

    await user.type(
      screen.getByRole("textbox", { name: "Message Aura" }),
      "Can you help?",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamPublicChatMock).toHaveBeenCalledTimes(1));
    expect(streamPublicChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "guest-token",
        sessionId,
        message: "Can you help?",
        mode: "code",
      }),
    );
    expect(screen.getByText("Can you help?")).toBeInTheDocument();
    expect(screen.getByText("Hello from Aura")).toBeInTheDocument();
  });

  it("shows a contextual login gate and disables the composer when the guest limit is reached", () => {
    act(() => {
      usePublicChatStore.setState({ turnCount: 3, limit: 3 });
    });

    renderView("/chat");

    expect(screen.getByText("Free chat limit reached")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You've used your 3 free messages. Log in or sign up to keep this conversation going.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("limit_reached")).not.toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Message Aura" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "Log in to keep chatting");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Log In" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign Up" })).toHaveAttribute(
      "href",
      "/login?tab=register",
    );
    expect(streamPublicChatMock).not.toHaveBeenCalled();
  });

  it("maps a raw limit_reached stream error into the login gate instead of rendering the raw code", async () => {
    const user = userEvent.setup();
    let sessionId = "";
    act(() => {
      sessionId = usePublicChatStore.getState().createSession();
      usePublicChatStore.setState({ turnCount: 2, limit: 3 });
    });
    streamPublicChatMock.mockImplementationOnce(
      (args: { onError: (e: Error) => void }) => {
        args.onError(new Error("limit_reached"));
        return { close: vi.fn() };
      },
    );

    renderView(`/chat?session=${sessionId}`);
    await user.type(
      screen.getByRole("textbox", { name: "Message Aura" }),
      "Guest test message 4",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText("Free chat limit reached")).toBeInTheDocument(),
    );
    expect(screen.queryByText("limit_reached")).not.toBeInTheDocument();
    expect(usePublicChatStore.getState().turnCount).toBe(3);
    expect(screen.getByRole("textbox", { name: "Message Aura" })).toBeDisabled();
  });

  it("re-mints a fresh guest token and retries once when the stream rejects a stale token", async () => {
    // Simulates the post-deploy state: the cached guest token was
    // signed with the previous server secret, so the first stream
    // attempt is rejected with "invalid guest token". The view must
    // discard the stale token, mint a fresh one, and replay the same
    // turn without surfacing an error to the visitor.
    const user = userEvent.setup();
    let sessionId = "";
    act(() => {
      sessionId = usePublicChatStore.getState().createSession();
    });
    usePublicChatStore.setState({ guestToken: "stale-token" });
    setupPublicSessionMock.mockResolvedValueOnce({
      token: "fresh-token",
      turn_count: 0,
      limit: 3,
    });
    streamPublicChatMock
      .mockImplementationOnce((args: { onError: (e: Error) => void }) => {
        args.onError(new Error("SSE request failed (401): invalid guest token"));
        return { close: vi.fn() };
      })
      .mockImplementationOnce(
        (args: { onDelta: (t: string) => void; onDone?: () => void }) => {
          args.onDelta("Recovered reply");
          args.onDone?.();
          return { close: vi.fn() };
        },
      );

    renderView(`/chat?session=${sessionId}`);
    await user.type(
      screen.getByRole("textbox", { name: "Message Aura" }),
      "Hi there",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamPublicChatMock).toHaveBeenCalledTimes(2));
    expect(setupPublicSessionMock).toHaveBeenCalledTimes(1);
    expect(streamPublicChatMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ token: "stale-token" }),
    );
    expect(streamPublicChatMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({ token: "fresh-token", message: "Hi there" }),
    );
    expect(await screen.findByText("Recovered reply")).toBeInTheDocument();
    expect(usePublicChatStore.getState().guestToken).toBe("fresh-token");
  });

  it("renders 7 persona ticks AND 7 panel rows including the Creator slot", () => {
    renderView();
    const personas = [
      "Creator",
      "Vibecoder",
      "Solo Builder",
      "Giga Brain",
      "Coordinator",
      "Researcher",
      "Cypher Punk",
    ];
    // Each persona is represented twice: once as a tick button in
    // the rail column, once as a row button inside the panel.
    for (const name of personas) {
      expect(tickFor(name)).toBeInTheDocument();
      expect(panelFor(name)).toBeInTheDocument();
    }
    expect(screen.getByTestId("persona-tick-rail")).toBeInTheDocument();
    expect(screen.getByTestId("persona-tick-rail-panel")).toBeInTheDocument();
  });

  it("starts closed with Creator marked active and opens the menu on rail hover", () => {
    renderView();
    const rail = screen.getByTestId("persona-tick-rail");
    expect(rail).toHaveAttribute("data-panel-open", "false");

    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Researcher")).not.toHaveAttribute("aria-current");

    fireEvent.mouseEnter(rail);
    expect(rail).toHaveAttribute("data-panel-open", "true");
  });

  it("keeps the overlay open when the cursor exits via the viewport's right edge", () => {
    // The rail and its panel hug the viewport's right edge; a
    // rightward exit has no other content to interact with, so the
    // menu must stay open and only close on up / down / left exits
    // (or a row click). Drive fake timers so the 80ms close debounce
    // can be flushed deterministically without a real wall-clock wait.
    vi.useFakeTimers();
    try {
      renderView();
      const rail = screen.getByTestId("persona-tick-rail");

      fireEvent.mouseEnter(rail);
      expect(rail).toHaveAttribute("data-panel-open", "true");

      fireEvent.mouseLeave(rail, {
        clientX: window.innerWidth,
        clientY: 200,
      });
      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(rail).toHaveAttribute("data-panel-open", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the overlay when the cursor exits leftward (away from the right edge)", () => {
    // Companion to the right-exit test above: a non-right exit still
    // schedules the standard 80ms debounced close so the visitor can
    // dismiss the menu by moving the cursor back toward the chat
    // surface.
    vi.useFakeTimers();
    try {
      renderView();
      const rail = screen.getByTestId("persona-tick-rail");

      fireEvent.mouseEnter(rail);
      expect(rail).toHaveAttribute("data-panel-open", "true");

      fireEvent.mouseLeave(rail, { clientX: 100, clientY: 200 });
      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(rail).toHaveAttribute("data-panel-open", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits the persona selection AND closes the menu when a panel row is clicked", () => {
    renderView();
    const rail = screen.getByTestId("persona-tick-rail");
    fireEvent.mouseEnter(rail);
    expect(rail).toHaveAttribute("data-panel-open", "true");

    fireEvent.click(panelFor("Researcher"));

    // The selection promoted Researcher to active and the menu
    // immediately closed, dropping the visitor back to the
    // minimal tick column with the new selection painted.
    expect(rail).toHaveAttribute("data-panel-open", "false");
    expect(tickFor("Researcher")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Creator")).not.toHaveAttribute("aria-current");
    expect(panelFor("Researcher")).toHaveAttribute("data-active", "true");
  });

  it("mounts the new persona's wallpaper + site bg immediately on click, with the OLD persona kept as a fading-out overlay until the dissolve completes", async () => {
    // Layered cross-fade contract: clicking a tick swaps the
    // committed persona in the SAME render as the click. The
    // previous persona is captured into an `outgoingDesktopBackground`
    // / outgoing `.siteBackground` snapshot that mounts ON TOP of
    // the new one with a 550ms fade-out animation. After
    // FADE_MS + 50ms the outgoing snapshot unmounts.
    vi.useFakeTimers();
    try {
      renderView();
      const heroStub = screen.getByTestId("mock-aura-app-stub");

      // Creator is the default landing theme: the mock window shows
      // the curated portrait and the PAGE bg is the full-screen WebGL
      // plasma (no `site.png` <img>), so the orb canvas — not a site
      // image — is present. No outgoing snapshot yet.
      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/creator/desktop.png",
      );
      expect(heroStub).toHaveAttribute("data-outgoing-desktop-bg", "");
      expect(
        screen.getByTestId("public-chat-site-bg-orb"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("public-chat-site-bg-image"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("public-chat-site-bg-outgoing"),
      ).not.toBeInTheDocument();

      fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
      fireEvent.click(panelFor("Solo Builder"));

      // Click immediately commits the new persona's wallpaper +
      // site bg. The OLD persona (Creator) is now the outgoing
      // snapshot mounted on top, so during the fade window BOTH the
      // new and outgoing wallpapers coexist in the DOM and the stub
      // exposes them via separate attributes. Creator's page bg was
      // the orb (no site image), so its outgoing overlay carries only
      // the dark base color — no <img> inside it.
      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/solo-builder/desktop.png",
      );
      expect(heroStub).toHaveAttribute(
        "data-outgoing-desktop-bg",
        "/personas/creator/desktop.png",
      );
      expect(heroStub.getAttribute("data-outgoing-fade-key")).not.toBe("");
      // Committed persona is now image-backed, so the orb is gone and
      // the Solo Builder site image paints.
      expect(
        screen.queryByTestId("public-chat-site-bg-orb"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("public-chat-site-bg-image"),
      ).toHaveAttribute("src", "/personas/solo-builder/site.png");
      const outgoingSiteBg = screen.getByTestId(
        "public-chat-site-bg-outgoing",
      );
      expect(outgoingSiteBg.querySelector("img")).toBeNull();

      // Advance past the 550ms fade-out window + 50ms teardown
      // grace. The outgoing layer unmounts and only the new
      // persona's snapshot remains in the DOM.
      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      expect(heroStub).toHaveAttribute(
        "data-desktop-bg",
        "/personas/solo-builder/desktop.png",
      );
      expect(heroStub).toHaveAttribute("data-outgoing-desktop-bg", "");
      expect(
        screen.queryByTestId("public-chat-site-bg-outgoing"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("public-chat-site-bg-image"),
      ).toHaveAttribute("src", "/personas/solo-builder/site.png");
      expect(
        document.querySelector('[data-persona-id="solo-builder"]'),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("flips the active tick AND the committed wallpaper/site bg in the SAME render as the click — only the outgoing overlay lingers", () => {
    // The previous "two-tier active vs committed" contract is gone:
    // active + committed advance together so the painted persona
    // matches the rail's aria-current immediately. The dissolve
    // effect now comes from the OUTGOING overlay layer being
    // captured at the moment of swap and animated to opacity 0.
    renderView();
    const heroStub = screen.getByTestId("mock-aura-app-stub");
    expect(heroStub).toHaveAttribute(
      "data-desktop-bg",
      "/personas/creator/desktop.png",
    );

    fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
    fireEvent.click(panelFor("Solo Builder"));

    // Active tick + aria-current flip immediately.
    expect(tickFor("Solo Builder")).toHaveAttribute("aria-current", "true");

    // Committed bg + wallpaper ALSO flip immediately to the new
    // persona — the visible-on-top outgoing layer is what carries
    // the OLD persona's pixels during the dissolve.
    expect(heroStub).toHaveAttribute(
      "data-desktop-bg",
      "/personas/solo-builder/desktop.png",
    );
    expect(heroStub).toHaveAttribute(
      "data-outgoing-desktop-bg",
      "/personas/creator/desktop.png",
    );
    expect(
      document.querySelector('[data-persona-id="solo-builder"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("public-chat-site-bg-image"),
    ).toHaveAttribute("src", "/personas/solo-builder/site.png");

    // The outgoing site bg overlay is mounted with the leaving
    // animation class so CSS can fade it from opacity 1 → 0 over
    // the next 550ms.
    const outgoingSiteBg = screen.getByTestId(
      "public-chat-site-bg-outgoing",
    );
    expect(outgoingSiteBg.className).toMatch(/Leaving/);
  });

  it("shares activeIndex between the right-edge tick rail and the bottom-left avatar dock — both directions", () => {
    // Single-piece-of-state contract: PublicChatView owns
    // `activeIndex` and forwards it to BOTH the right-edge rail
    // (via `aria-current`) AND the bottom-left avatar dock inside
    // MockAuraApp (via `activePersonaIndex`). The handler each
    // surface calls (`onActiveIndexChange` / `onPersonaSelect`) is
    // the same `setActiveIndex` setter, so a click on either
    // surface updates BOTH surfaces in the next render. This test
    // pins that loop by alternating clicks between the two
    // entry points.
    renderView();
    const heroStub = screen.getByTestId("mock-aura-app-stub");

    // Initial state: Creator (index 0) is active in both
    // surfaces.
    expect(heroStub).toHaveAttribute("data-active-persona-index", "0");
    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");

    // Click the dock's Solo Builder avatar (index 2) — the rail's
    // aria-current jumps to Solo Builder in the same render.
    fireEvent.click(
      screen.getByTestId("mock-aura-app-dock-select-solo-builder"),
    );
    expect(heroStub).toHaveAttribute("data-active-persona-index", "2");
    expect(tickFor("Solo Builder")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Creator")).not.toHaveAttribute("aria-current");

    // Click a rail row — the dock's `activePersonaIndex` jumps to
    // Researcher (index 5) in the same render, proving the wiring
    // works in both directions.
    fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
    fireEvent.click(panelFor("Researcher"));
    expect(heroStub).toHaveAttribute("data-active-persona-index", "5");
    expect(tickFor("Researcher")).toHaveAttribute("aria-current", "true");
  });

  it("publishes per-persona foreground CSS vars on <html> for the public nav footer + tick rail to read", () => {
    const { unmount } = renderView();
    const root = document.documentElement;

    // Creator is the default and pins the dark-mode text token
    // pair (`#e6e8eb` / `#c9c9cf`) because its dark plasma page bg
    // is theme-invariant — the foreground must be theme-invariant
    // too, otherwise the public nav collapses to near-black on the
    // dark bg in light mode.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#e6e8eb",
    );
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "#c9c9cf",
    );

    const rail = screen.getByTestId("persona-tick-rail");
    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Solo Builder"));

    // Solo Builder ships with a near-black pair so the marketing
    // footer + idle ticks stay legible over its light dusty-blue
    // site background.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#0a0a0a",
    );
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "#1a1a1a",
    );

    // Researcher ships with a warm, light page background paired
    // with near-black foreground overrides so the public nav footer
    // and tick rail stay legible over the portrait theme.
    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Researcher"));
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#0a0a0a",
    );
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "#1a1a1a",
    );

    // Re-select Solo Builder so the cleanup path on unmount has
    // something to clear (otherwise the assertion below is a no-op).
    fireEvent.mouseEnter(rail);
    fireEvent.click(panelFor("Solo Builder"));
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe(
      "#0a0a0a",
    );

    unmount();
    // Leaving public mode (e.g. login -> authed shell) must not leak
    // contrast overrides into surfaces that don't mount the marketing
    // footer or tick rail.
    expect(root.style.getPropertyValue("--public-nav-fg-color")).toBe("");
    expect(root.style.getPropertyValue("--public-nav-fg-color-muted")).toBe(
      "",
    );
  });
});

/**
 * Wheel-driven persona carousel + scroll-into-agents handoff: while
 * the landing scroll column sits at `scrollTop === 0` the surface
 * acts as a vertical carousel — wheel-down advances one persona per
 * event (no time-based throttle), wheel-up rewinds, both CLAMPED at
 * the ends. Wheeling down past the LAST persona glides the column
 * into the embedded `/agents` content instead of wrapping; once
 * scrolled (`scrollTop > 0`) wheel events are fully native, and
 * arriving back at the top re-locks the carousel behind a
 * momentum-settle guard.
 */
describe("PublicChatView wheel cycling", () => {
  function scroller(): HTMLElement {
    return screen.getByTestId("public-chat-scroll");
  }

  function wheel(deltaY: number): void {
    fireEvent.wheel(scroller(), { deltaY });
  }

  it("advances to the next persona on a wheel-down gesture", () => {
    renderView();
    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");

    wheel(120);

    expect(tickFor("Vibecoder")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Creator")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "1",
    );
  });

  it("clamps at the first persona on a wheel-up gesture (no backward wrap)", () => {
    // The carousel no longer wraps: "before the first persona" and
    // "after the last persona" are meaningful boundaries now that
    // the end of the cycle hands off into the agents scroll. A
    // wheel-up on Creator (index 0) stays on Creator.
    renderView();
    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");

    wheel(-120);

    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "0",
    );
  });

  it("glides into the agents content on the wheel-down past the last persona instead of wrapping", () => {
    // Land on Cypher Punk (the last persona) via the panel, then
    // wheel down once more: the persona must NOT wrap back to
    // Creator — instead the scroll column tweens one viewport
    // height down into the embedded agents page. Fake timers drive
    // the rAF tween deterministically; the column's clientHeight is
    // stubbed because jsdom has no layout.
    vi.useFakeTimers();
    try {
      renderView();
      const column = scroller();
      Object.defineProperty(column, "clientHeight", {
        configurable: true,
        value: 600,
      });
      fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
      fireEvent.click(panelFor("Cypher Punk"));
      expect(tickFor("Cypher Punk")).toHaveAttribute("aria-current", "true");

      wheel(120);

      // Persona stays clamped on the last entry...
      expect(tickFor("Cypher Punk")).toHaveAttribute("aria-current", "true");
      expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
        "data-active-persona-index",
        "6",
      );

      // ...and the rAF tween glides scrollTop to one viewport height
      // (the top of the agents hero) once the 700ms window elapses.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(column.scrollTop).toBe(600);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cycle personas while scrolled into the agents content", () => {
    // Once the visitor is inside the embedded agents page
    // (`scrollTop > 0`), wheel events belong to the native scroll —
    // intercepting them there would flip the persona theme with no
    // carousel on screen.
    renderView();
    const column = scroller();
    column.scrollTop = 500;

    wheel(120);
    wheel(-120);

    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "0",
    );
  });

  it("re-locks the carousel at the top behind a momentum-settle guard", () => {
    // An upward fling that lands the column back at `scrollTop === 0`
    // keeps streaming inertial wheel-up events; those must be
    // swallowed until a settle gap (WHEEL_SETTLE_MS = 160) passes
    // with no wheel activity, then deliberate cycling resumes.
    vi.useFakeTimers();
    try {
      renderView();
      fireEvent.mouseEnter(screen.getByTestId("persona-tick-rail"));
      fireEvent.click(panelFor("Cypher Punk"));
      const column = scroller();

      // Visitor is in the agents region scrolling up: wheel events
      // pass through natively but their timestamps are tracked.
      column.scrollTop = 500;
      fireEvent.scroll(column);
      wheel(-120);

      // The fling reaches the top — re-lock arms the settle guard.
      column.scrollTop = 0;
      fireEvent.scroll(column);

      // Inertial leftovers arriving within the settle window are
      // swallowed: still Cypher Punk.
      act(() => {
        vi.advanceTimersByTime(50);
      });
      wheel(-120);
      expect(tickFor("Cypher Punk")).toHaveAttribute("aria-current", "true");

      // After a quiet gap longer than the settle window, the next
      // deliberate wheel-up resumes backward cycling.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      wheel(-120);
      expect(tickFor("Researcher")).toHaveAttribute("aria-current", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("advances one persona per wheel event with no time-based throttle", () => {
    // The original implementation debounced consecutive wheel events
    // behind a 350ms cooldown. The current "feels fast" contract
    // intentionally has no cooldown: three wheel-downs in immediate
    // succession advance three personas (Creator → Vibecoder → Solo
    // Builder → Giga Brain), proving that nothing in the handler
    // swallows events that arrive on the same tick as a prior
    // accepted event.
    renderView();
    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");

    wheel(120);
    wheel(120);
    wheel(120);

    expect(tickFor("Giga Brain")).toHaveAttribute("aria-current", "true");
    expect(tickFor("Vibecoder")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "3",
    );
  });

  it("a wheel-down stream past the end clamps on the last persona (the handoff owns the boundary)", () => {
    // Eight wheel-down events from index 0: six advance Creator →
    // Cypher Punk (index 6), the seventh starts the glide into the
    // agents content, the eighth is swallowed by the in-flight
    // tween. The persona must never wrap back through Creator.
    renderView();

    for (let i = 0; i < 8; i += 1) wheel(120);

    expect(tickFor("Cypher Punk")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "6",
    );
  });

  /*
   * Companion to the "hides the MockAuraApp hero AND the persona
   * tick rail on /chat" test in the main suite above: with both
   * surfaces unmounted, the wheel handler must also short-circuit
   * so an in-transcript scroll doesn't silently flip the page bg
   * persona from underneath the visitor (they'd see the theme
   * change with no on-screen affordance explaining why). We can't
   * easily read the persona state through the test ids the rest
   * of this `describe` block uses — the rail + hero stub are
   * unmounted on `/chat` by construction — so we read the active
   * persona via the `data-persona-id` attribute on `.chatView`
   * that the component publishes for the site-bg layer.
   */
  it("does not cycle personas on /chat (no on-screen selector to indicate the gesture)", () => {
    // The rail + hero stub are unmounted on /chat, so we read the
    // active persona via the `data-persona-id` attribute on
    // `.chatView` itself — it's bound to the committed persona and
    // updates in the same render the wheel handler accepts an
    // event. If the chat-mode short-circuit ever regresses, this
    // attribute flips after the first wheel-down call below and
    // the assertion fires.
    renderView("/chat");

    const view = screen.getByTestId("public-chat-view");
    expect(view).toHaveAttribute("data-persona-id", "creator");

    fireEvent.wheel(view, { deltaY: 120 });
    fireEvent.wheel(view, { deltaY: 120 });
    fireEvent.wheel(view, { deltaY: -120 });

    // Persona stays pinned to Creator — none of the three wheel
    // gestures advanced the active index.
    expect(view).toHaveAttribute("data-persona-id", "creator");
  });

  it("ignores near-zero deltaY events (horizontal trackpad jitter)", () => {
    // Some browsers fold tiny horizontal trackpad noise into
    // `deltaY` as sub-pixel values; without the magnitude floor a
    // sideways two-finger swipe would occasionally flip the
    // persona. WHEEL_DELTA_THRESHOLD = 4 keeps those out.
    renderView();
    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");

    wheel(1);
    wheel(-2);
    wheel(3);

    expect(tickFor("Creator")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("mock-aura-app-stub")).toHaveAttribute(
      "data-active-persona-index",
      "0",
    );
  });
});
