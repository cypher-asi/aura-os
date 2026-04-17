import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedbackItemCard } from "./FeedbackItemCard";
import type { FeedbackItem } from "../types";

vi.mock("./FeedbackItemCard.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

const baseItem: FeedbackItem = {
  id: "fb-1",
  author: { name: "Ada", type: "user" },
  title: "Keyboard shortcuts please",
  body: "Cmd+1/2/3 between panels",
  category: "feature_request",
  status: "in_review",
  upvotes: 10,
  downvotes: 2,
  voteScore: 8,
  viewerVote: "none",
  commentCount: 3,
  createdAt: new Date().toISOString(),
};

describe("FeedbackItemCard", () => {
  it("calls onSelect when the card is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FeedbackItemCard
        item={baseItem}
        isSelected={false}
        onSelect={onSelect}
        onVote={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Keyboard shortcuts please"));
    expect(onSelect).toHaveBeenCalledWith("fb-1");
  });

  it("upvote toggles on when viewer had no vote, and toggles off when already up", () => {
    const onVote = vi.fn();
    const { rerender } = render(
      <FeedbackItemCard
        item={baseItem}
        isSelected={false}
        onSelect={() => {}}
        onVote={onVote}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Upvote" }));
    expect(onVote).toHaveBeenLastCalledWith("fb-1", "up");

    rerender(
      <FeedbackItemCard
        item={{ ...baseItem, viewerVote: "up" }}
        isSelected={false}
        onSelect={() => {}}
        onVote={onVote}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Upvote" }));
    expect(onVote).toHaveBeenLastCalledWith("fb-1", "none");
  });

  it("does not fire onSelect when a vote button is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FeedbackItemCard
        item={baseItem}
        isSelected={false}
        onSelect={onSelect}
        onVote={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Downvote" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the comment count and selects when it is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FeedbackItemCard
        item={baseItem}
        isSelected={false}
        onSelect={onSelect}
        onVote={() => {}}
      />,
    );

    const button = screen.getByLabelText("3 comments");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("fb-1");
  });

  it("hides the comment count when there are no comments", () => {
    render(
      <FeedbackItemCard
        item={{ ...baseItem, commentCount: 0 }}
        isSelected={false}
        onSelect={() => {}}
        onVote={() => {}}
      />,
    );

    expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
  });
});
