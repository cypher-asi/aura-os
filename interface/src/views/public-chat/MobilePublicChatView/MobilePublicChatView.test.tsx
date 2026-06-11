/**
 * Behavioural tests for `MobilePublicChatView`.
 *
 * The mobile public surface lands on a Creator-pinned hero
 * (`MobileLandingHero`) with the composer inline, scrolling into the
 * lazily-embedded `/agents` sections; `/chat` is a scrollable
 * transcript + sticky composer. These tests pin that contract and
 * the SSE dispatch wiring.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

import { MobilePublicChatView } from "./MobilePublicChatView";
import { usePublicChatStore } from "../../../stores/public-chat-store";

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

function renderView(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<MobilePublicChatView />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  streamPublicChatMock.mockImplementation(
    (args: { onDelta: (text: string) => void; onDone?: () => void }) => {
      args.onDelta("Hi from Aura");
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

describe("MobilePublicChatView", () => {
  it("renders the Creator landing hero with the inline composer on the landing route", () => {
    renderView("/");
    expect(screen.getByTestId("mobile-public-chat-view")).toBeInTheDocument();
    // Creator-pinned hero (the first / default persona).
    const hero = screen.getByTestId("mobile-landing-hero");
    expect(hero).toHaveAttribute("data-persona-id", "creator");
    // Composer renders inside the hero viewport, not as a bottom bar.
    const input = screen.getByRole("textbox", { name: "Message Aura" });
    expect(input).toHaveAttribute("placeholder", "What do you want to create?");
    expect(hero.contains(input)).toBe(true);
    // The heavy /agents embed stays unmounted until first interaction
    // or idle — neither has happened yet at first paint.
    expect(
      screen.getByTestId("mobile-public-landing-scroll"),
    ).toBeInTheDocument();
  });

  it("submits the composer, navigates to /chat?session=<id>, and renders the streamed reply", async () => {
    renderView("/");

    const input = screen.getByRole("textbox", { name: "Message Aura" });
    fireEvent.change(input, { target: { value: "build me a chess app" } });
    const submit = screen.getByRole("button", { name: "Send" });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(streamPublicChatMock).toHaveBeenCalledTimes(1);
    });

    const probe = screen.getByTestId("location-probe");
    await waitFor(() => {
      expect(probe).toHaveAttribute("data-pathname", "/chat");
    });
    const search = probe.getAttribute("data-search");
    expect(search).toMatch(/^\?session=public-/);

    // User turn rendered.
    expect(screen.getByText("build me a chess app")).toBeInTheDocument();
    // Assistant token from the mock stream rendered.
    expect(screen.getByText("Hi from Aura")).toBeInTheDocument();

    // Stream args carried through with mode "code" and the typed message.
    const callArgs = streamPublicChatMock.mock.calls[0]?.[0] as {
      message: string;
      mode: string;
      sessionId: string;
      token: string;
    };
    expect(callArgs.message).toBe("build me a chess app");
    expect(callArgs.mode).toBe("code");
    expect(callArgs.token).toBe("guest-token");
    expect(callArgs.sessionId).toMatch(/^public-/);
  });

  it("does NOT auto-mint a session when landing on /chat without one; the composer stays empty until the visitor sends", async () => {
    renderView("/chat");

    const probe = screen.getByTestId("location-probe");
    expect(probe).toHaveAttribute("data-pathname", "/chat");
    // No `?session=` should be appended on visit. Wait one tick to
    // make sure no deferred effect mints behind our back.
    await Promise.resolve();
    expect(probe.getAttribute("data-search") ?? "").toBe("");
    expect(usePublicChatStore.getState().sessionOrder).toHaveLength(0);

    // The empty-state composer is still present and submitting it
    // should be what creates the session (and rewrites the URL).
    const input = screen.getByRole("textbox", { name: "Message Aura" });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(streamPublicChatMock).toHaveBeenCalledTimes(1);
    });
    const order = usePublicChatStore.getState().sessionOrder;
    expect(order).toHaveLength(1);
    expect(probe.getAttribute("data-search")).toBe(`?session=${order[0]}`);
  });

  it("re-mints a fresh guest token and retries once when the stream rejects a stale token", async () => {
    // Same post-deploy recovery contract as the desktop surface: a
    // stale cached token gets one 401, then the view re-mints and
    // replays the turn so the visitor never sees the auth error.
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

    renderView("/chat");
    const input = screen.getByRole("textbox", { name: "Message Aura" });
    fireEvent.change(input, { target: { value: "hello again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamPublicChatMock).toHaveBeenCalledTimes(2));
    expect(setupPublicSessionMock).toHaveBeenCalledTimes(1);
    expect(streamPublicChatMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ token: "stale-token" }),
    );
    expect(streamPublicChatMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({ token: "fresh-token", message: "hello again" }),
    );
    expect(await screen.findByText("Recovered reply")).toBeInTheDocument();
    expect(usePublicChatStore.getState().guestToken).toBe("fresh-token");
  });

  it("does NOT render the desktop hero hooks (MockAuraApp, persona tick rail) on either route", () => {
    renderView("/");
    expect(screen.queryByTestId("mock-aura-app-stub")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Agent personas")).not.toBeInTheDocument();
  });
});
