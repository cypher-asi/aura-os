import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardUser } from "../../../stores/leaderboard-store";

vi.mock("./LeaderboardContent.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("@cypher-asi/zui", () => ({
  Text: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <span className={className}>{children}</span>,
}));

vi.mock("../../../components/Avatar", () => ({
  Avatar: () => <span data-testid="avatar" />,
}));

vi.mock("../../../api/client", () => ({
  api: {
    leaderboard: {
      get: vi.fn(),
    },
  },
}));

vi.mock("../../../stores/org-store", () => ({
  useOrgStore: {
    getState: () => ({ activeOrg: null }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("../../../stores/event-store", () => ({
  useEventStore: {
    getState: () => ({
      subscribe: vi.fn(),
    }),
  },
}));

vi.mock("../../../stores/leaderboard-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../stores/leaderboard-store")>();
  return {
    ...actual,
    startLeaderboardRefresh: vi.fn(),
    stopLeaderboardRefresh: vi.fn(),
  };
});

import { LeaderboardContent } from "./LeaderboardContent";
import {
  useLeaderboardStore,
  startLeaderboardRefresh,
  stopLeaderboardRefresh,
} from "../../../stores/leaderboard-store";

const entries: LeaderboardUser[] = [
  {
    id: "user-1",
    name: "Alice",
    type: "user",
    tokens: 1200,
    estimatedCostUsd: 1.25,
    eventCount: 14,
  },
  {
    id: "user-2",
    name: "Bob",
    type: "agent",
    tokens: 900,
    estimatedCostUsd: 0.75,
    eventCount: 9,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useLeaderboardStore.setState({
    entries,
    selectedUserId: null,
    loading: false,
    init: vi.fn(),
    fetchEntries: vi.fn(() => Promise.resolve()),
    selectUser: (id) => useLeaderboardStore.setState({ selectedUserId: id }),
  });
});

describe("LeaderboardContent", () => {
  it("highlights the selected row and moves the highlight", () => {
    render(<LeaderboardContent />);

    const aliceRow = screen.getByText("Alice").closest(".row");
    const bobRow = screen.getByText("Bob").closest(".row");

    expect(aliceRow).not.toHaveClass("rowActive");
    expect(bobRow).not.toHaveClass("rowActive");

    fireEvent.click(aliceRow!);

    expect(aliceRow).toHaveClass("rowActive");
    expect(bobRow).not.toHaveClass("rowActive");

    fireEvent.click(bobRow!);

    expect(aliceRow).not.toHaveClass("rowActive");
    expect(bobRow).toHaveClass("rowActive");
  });

  it("refreshes on open and tears down the live refresh on close", () => {
    const { init, fetchEntries } = useLeaderboardStore.getState();
    const { unmount } = render(<LeaderboardContent />);

    // Opening the leaderboard pulls fresh data and starts the live refresh.
    expect(init).toHaveBeenCalledTimes(1);
    expect(fetchEntries).toHaveBeenCalledTimes(1);
    expect(startLeaderboardRefresh).toHaveBeenCalledTimes(1);
    expect(stopLeaderboardRefresh).not.toHaveBeenCalled();

    // Leaving the leaderboard stops the poll so nothing runs in the background.
    unmount();
    expect(stopLeaderboardRefresh).toHaveBeenCalledTimes(1);
  });
});
