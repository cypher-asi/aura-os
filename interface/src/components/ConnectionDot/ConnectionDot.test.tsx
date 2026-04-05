import { render, screen, act } from "@testing-library/react";
import { useEventStore } from "../../stores/event-store/index";

vi.mock("../../stores/event-store/index", () => {
  const store = {
    connected: true,
    lastEventAt: null as number | null,
    subscribe: vi.fn(() => vi.fn()),
  };
  const useEventStore = Object.assign(
    (selector: (s: typeof store) => unknown) => selector(store),
    {
      getState: () => store,
      setState: (patch: Partial<typeof store>) => Object.assign(store, patch),
      subscribe: vi.fn(),
    },
  );
  return { useEventStore };
});

vi.mock("./ConnectionDot.module.css", () => ({
  default: { connectionDot: "connectionDot" },
}));

import { ConnectionDot } from "../ConnectionDot";

function setStoreState(patch: { connected?: boolean; lastEventAt?: number | null }) {
  (useEventStore as unknown as { setState: (p: Record<string, unknown>) => void }).setState(patch);
}

beforeEach(() => {
  vi.useFakeTimers();
  setStoreState({ connected: true, lastEventAt: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConnectionDot", () => {
  it("shows 'Connected — receiving events' when connected and not stale", () => {
    setStoreState({ connected: true, lastEventAt: Date.now() });
    render(<ConnectionDot />);
    expect(screen.getByTitle("Connected — receiving events")).toBeInTheDocument();
  });

  it("shows 'Disconnected — reconnecting...' when not connected", () => {
    setStoreState({ connected: false });
    render(<ConnectionDot />);
    expect(screen.getByTitle("Disconnected — reconnecting...")).toBeInTheDocument();
  });

  it("shows stale warning when last event was > 10 s ago", () => {
    setStoreState({ connected: true, lastEventAt: Date.now() - 15_000 });
    render(<ConnectionDot />);

    act(() => {
      vi.advanceTimersByTime(2_100);
    });

    expect(screen.getByTitle("Connected but no events received recently")).toBeInTheDocument();
  });

  it("does not show stale warning when lastEventAt is recent", () => {
    setStoreState({ connected: true, lastEventAt: Date.now() - 1_000 });
    render(<ConnectionDot />);

    act(() => {
      vi.advanceTimersByTime(2_100);
    });

    expect(screen.getByTitle("Connected — receiving events")).toBeInTheDocument();
  });
});
