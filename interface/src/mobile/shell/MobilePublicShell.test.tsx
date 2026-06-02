/**
 * Behavioural tests for `MobilePublicShell`.
 *
 * The mobile public shell ships the only delete affordance on the
 * mobile public surface — a trash button in the topbar that
 * appears when the visitor is on `/chat?session=<id>` with a real
 * session. There's no separate session list on mobile, so this
 * is the only entry point for removing a chat.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/analytics", () => ({
  track: vi.fn(),
}));

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const stub = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: stub,
    });
  }
});

import { MobilePublicShell } from "./MobilePublicShell";
import { usePublicChatStore } from "../../stores/public-chat-store";

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

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<MobilePublicShell />}>
          <Route path="*" element={<div data-testid="outlet-content" />} />
        </Route>
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  act(() => {
    usePublicChatStore.setState({
      sessions: {},
      sessionOrder: [],
      turnCount: 0,
      guestToken: "guest-token",
      setupInFlight: false,
    });
  });
});

afterEach(() => {
  window.localStorage.clear();
  act(() => {
    usePublicChatStore.setState({
      sessions: {},
      sessionOrder: [],
      turnCount: 0,
      guestToken: null,
      setupInFlight: false,
    });
  });
});

describe("MobilePublicShell trash affordance", () => {
  it("does NOT render the trash button on the landing route", () => {
    renderShell("/");
    expect(
      screen.queryByTestId("mobile-public-delete-chat"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the trash button on /chat without a session", () => {
    renderShell("/chat");
    expect(
      screen.queryByTestId("mobile-public-delete-chat"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the trash button when the `?session=` param points at a missing session", () => {
    // A stale URL (e.g. localStorage cleared in another tab) must
    // not light up a delete button against a non-existent session;
    // there's nothing to delete.
    renderShell("/chat?session=public-stale-id");
    expect(
      screen.queryByTestId("mobile-public-delete-chat"),
    ).not.toBeInTheDocument();
  });

  it("renders the trash button on /chat?session=<id> when the session exists", () => {
    let id = "";
    act(() => {
      id = usePublicChatStore.getState().createSession();
    });

    renderShell(`/chat?session=${id}`);

    const trashBtn = screen.getByTestId("mobile-public-delete-chat");
    expect(trashBtn).toBeInTheDocument();
    expect(trashBtn).toHaveAttribute(
      "aria-label",
      'Delete chat "New chat"',
    );
  });

  it("clicking the trash button removes the active session and lands on bare `/chat` when it was the only one", async () => {
    const user = userEvent.setup();
    let onlyId = "";
    act(() => {
      onlyId = usePublicChatStore.getState().createSession();
    });

    renderShell(`/chat?session=${onlyId}`);

    await user.click(screen.getByTestId("mobile-public-delete-chat"));

    expect(usePublicChatStore.getState().sessions[onlyId]).toBeUndefined();
    expect(usePublicChatStore.getState().sessionOrder).toEqual([]);
    const probe = screen.getByTestId("location-probe");
    expect(probe).toHaveAttribute("data-pathname", "/chat");
    expect(probe).toHaveAttribute("data-search", "");
  });

  it("clicking the trash button hops to the next remaining session when others exist", async () => {
    const user = userEvent.setup();
    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(firstId, "first chat");
      secondId = usePublicChatStore.getState().createSession();
    });

    // The second (most recent, newest-first in `sessionOrder`) is
    // active. Deleting it should drop the visitor onto the first
    // remaining session rather than spawning a fresh empty chat.
    renderShell(`/chat?session=${secondId}`);

    await user.click(screen.getByTestId("mobile-public-delete-chat"));

    expect(usePublicChatStore.getState().sessions[secondId]).toBeUndefined();
    expect(usePublicChatStore.getState().sessionOrder).toEqual([firstId]);
    const probe = screen.getByTestId("location-probe");
    expect(probe).toHaveAttribute("data-pathname", "/chat");
    expect(probe).toHaveAttribute("data-search", `?session=${firstId}`);
  });

  it("renders the topbar wordmark and outlet for the visited public route", () => {
    renderShell("/");
    expect(screen.getByLabelText("AURA home")).toBeInTheDocument();
    expect(screen.getByTestId("outlet-content")).toBeInTheDocument();
  });
});
