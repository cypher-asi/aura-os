import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    "aria-label": ariaLabel,
    onClick,
  }: {
    "aria-label"?: string;
    onClick?: () => void;
  }) => (
    <button type="button" aria-label={ariaLabel} onClick={onClick}>
      close
    </button>
  ),
}));

import { vi } from "vitest";
import { FeedbackSidekickHeader } from "./FeedbackSidekickHeader";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackItem } from "../types";

const item: FeedbackItem = {
  id: "fb-1",
  author: { name: "Ada", type: "user" },
  title: "Hotkeys please",
  body: "Cmd+1/2/3",
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

describe("FeedbackSidekickHeader", () => {
  beforeEach(() => {
    useFeedbackStore.setState({ items: [item], selectedId: "fb-1" });
  });

  it("renders author name and category label when an item is selected", () => {
    render(<FeedbackSidekickHeader />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(/Feature Request/i)).toBeInTheDocument();
  });

  it("renders nothing when there is no selected item", () => {
    useFeedbackStore.setState({ selectedId: null });
    const { container } = render(<FeedbackSidekickHeader />);
    expect(container).toBeEmptyDOMElement();
  });

  it("clears the selection when the close button is clicked", () => {
    render(<FeedbackSidekickHeader />);
    fireEvent.click(screen.getByLabelText("Close feedback detail"));
    expect(useFeedbackStore.getState().selectedId).toBeNull();
  });
});
