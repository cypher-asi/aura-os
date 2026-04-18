import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("../../../components/Lane", () => ({
  Lane: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));
vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children: ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));
vi.mock("../NewFeedbackModal", () => ({
  NewFeedbackModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="new-feedback-modal" /> : null,
}));
vi.mock("../FeedbackItemCard", () => ({
  FeedbackItemCard: ({ item }: { item: { id: string; title: string } }) => (
    <li data-testid="item-card" data-id={item.id}>
      {item.title}
    </li>
  ),
}));
vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: false }),
}));

import { FeedbackMainPanel } from "./FeedbackMainPanel";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackItem } from "../types";

function makeItem(id: string, title: string): FeedbackItem {
  return {
    id,
    author: { name: "Ada", type: "user" },
    title,
    body: "",
    category: "feature_request",
    status: "in_review",
    product: "aura",
    upvotes: 0,
    downvotes: 0,
    voteScore: 0,
    viewerVote: "none",
    commentCount: 0,
    createdAt: new Date().toISOString(),
  };
}

describe("FeedbackMainPanel", () => {
  beforeEach(() => {
    useFeedbackStore.setState({
      items: [],
      comments: [],
      selectedId: null,
      isLoading: false,
      hasLoaded: true,
      loadError: null,
      isComposerOpen: false,
      productFilter: "aura",
    });
  });

  it("shows 'Loading feedback...' before the first bootstrap completes", () => {
    useFeedbackStore.setState({ hasLoaded: false, isLoading: true });
    render(<FeedbackMainPanel />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      "Loading feedback...",
    );
  });

  it("surfaces the load error inline when the bootstrap fails", () => {
    useFeedbackStore.setState({
      hasLoaded: true,
      isLoading: false,
      loadError: "network down",
    });
    render(<FeedbackMainPanel />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      "Could not load feedback: network down",
    );
  });

  it("invites the user to post when the list is empty", () => {
    render(<FeedbackMainPanel />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      "No feedback yet",
    );
  });

  it("renders a card per sorted item when the list has content", () => {
    useFeedbackStore.setState({
      items: [makeItem("fb-1", "First"), makeItem("fb-2", "Second")],
    });
    render(<FeedbackMainPanel />);
    expect(screen.getAllByTestId("item-card")).toHaveLength(2);
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("opens the composer when the New Idea button is clicked", () => {
    render(<FeedbackMainPanel />);
    screen.getByRole("button", { name: "New Idea" }).click();
    expect(useFeedbackStore.getState().isComposerOpen).toBe(true);
  });
});
