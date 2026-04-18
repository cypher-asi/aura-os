import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));
vi.mock("../../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => (
    <span data-testid="avatar" aria-hidden="true">
      {name.charAt(0)}
    </span>
  ),
}));
vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));

import { FeedbackSidekickPanel } from "./FeedbackSidekickPanel";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackItem, FeedbackComment } from "../types";

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

const comment: FeedbackComment = {
  id: "c-1",
  itemId: "fb-1",
  author: { name: "Grace", type: "user" },
  text: "Nice idea",
  createdAt: new Date().toISOString(),
};

describe("FeedbackSidekickPanel", () => {
  beforeEach(() => {
    useFeedbackStore.setState({
      items: [item],
      comments: [],
      selectedId: null,
    });
  });

  it("prompts the user to pick a feedback item when none is selected", () => {
    render(<FeedbackSidekickPanel />);
    expect(
      screen.getByText("Select a feedback item to view comments"),
    ).toBeInTheDocument();
  });

  it("shows 'No comments yet' when the selected item has none", () => {
    useFeedbackStore.setState({ selectedId: "fb-1" });
    render(<FeedbackSidekickPanel />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("renders existing comments for the selected item", () => {
    useFeedbackStore.setState({ selectedId: "fb-1", comments: [comment] });
    render(<FeedbackSidekickPanel />);
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Nice idea")).toBeInTheDocument();
  });

  it("calls addComment through the store on Enter and clears the draft", () => {
    const addComment = vi.fn();
    useFeedbackStore.setState({ selectedId: "fb-1", addComment });

    render(<FeedbackSidekickPanel />);
    const textarea = screen.getByLabelText("Add a comment") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "LGTM" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(addComment).toHaveBeenCalledWith("fb-1", "LGTM");
    expect(textarea.value).toBe("");
  });

  it("keeps the send button disabled until there is non-whitespace text", () => {
    useFeedbackStore.setState({ selectedId: "fb-1" });
    render(<FeedbackSidekickPanel />);
    const send = screen.getByLabelText("Send comment") as HTMLButtonElement;
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "   " },
    });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "done" },
    });
    expect(send).not.toBeDisabled();
  });
});
