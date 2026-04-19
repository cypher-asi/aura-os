import * as React from "react";
import { render, screen } from "../../../test/render";

const mockUseAuraCapabilities = vi.fn();
const mockInit = vi.fn();
const mockUseFeed = vi.fn();

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../../stores/feed-store", () => ({
  useFeedStore: (selector: (state: { init: () => void }) => unknown) => selector({ init: mockInit }),
  useFeed: () => mockUseFeed(),
}));

vi.mock("../../../lib/auth-token", () => ({
  authHeaders: () => ({}),
  getStoredJwt: () => null,
  getStoredSession: () => null,
  hydrateStoredAuth: async () => null,
  setStoredAuth: async () => {},
  clearStoredAuth: async () => {},
}));

vi.mock("../../../components/Lane", () => ({
  Lane: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/CommitGrid", () => ({
  CommitGrid: () => <div data-testid="commit-grid" />,
}));

vi.mock("../../../components/ActivityCard", () => ({
  ActivityCard: ({ event }: { event: { title: string } }) => <div>{event.title}</div>,
}));

vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));

vi.mock("./FeedMainPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { FeedMainPanel } from "./FeedMainPanel";

describe("FeedMainPanel", () => {
  const baseFeedState = {
    filter: "organization",
    setFilter: vi.fn(),
    filteredEvents: [{ id: "evt-1", title: "Event one" }],
    commitActivity: {},
    selectedEventId: null,
    selectEvent: vi.fn(),
    selectProfile: vi.fn(),
    getCommentsForEvent: vi.fn(() => []),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    mockUseFeed.mockReturnValue(baseFeedState);
  });

  it("hides the commit grid when there is no commit activity", () => {
    render(<FeedMainPanel />);

    expect(screen.queryByTestId("commit-grid")).not.toBeInTheDocument();
    expect(screen.getByText("Event one")).toBeInTheDocument();
  });

  it("shows the commit grid when there is commit activity to display", () => {
    mockUseFeed.mockReturnValue({
      ...baseFeedState,
      commitActivity: {
        "2026-04-19:11": 2,
      },
    });

    render(<FeedMainPanel />);

    expect(screen.getByTestId("commit-grid")).toBeInTheDocument();
  });
});
