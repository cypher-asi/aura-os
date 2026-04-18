import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const feedbackApiMock = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  get: vi.fn(),
  create: vi.fn(),
  updateStatus: vi.fn(async () => undefined),
  listComments: vi.fn(async () => []),
  addComment: vi.fn(),
  castVote: vi.fn(async () => undefined),
}));

vi.mock("../../../api/client", () => ({
  api: { feedback: feedbackApiMock },
}));

import { NewFeedbackModal } from "./NewFeedbackModal";
import { useFeedbackStore } from "../../../stores/feedback-store";
import type { FeedbackItemDto } from "../../../api/feedback";

vi.mock("./NewFeedbackModal.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../../hooks/use-modal-initial-focus", () => ({
  useModalInitialFocus: () => ({
    inputRef: { current: null },
    initialFocusRef: undefined,
    autoFocus: false,
  }),
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        <div>{children}</div>
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("NewFeedbackModal", () => {
  beforeEach(() => {
    feedbackApiMock.create.mockReset();
    useFeedbackStore.setState({
      items: [],
      comments: [],
      selectedId: null,
      composerError: null,
      isSubmitting: false,
      productFilter: "aura",
    });
  });

  it("renders nothing when closed", () => {
    render(<NewFeedbackModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("disables Post until a body is entered, then submits and closes", async () => {
    const onClose = vi.fn();
    const dto: FeedbackItemDto = {
      id: "fb-1",
      profileId: "p1",
      eventType: "feedback",
      postType: "post",
      title: "dark mode",
      summary: "Please add dark mode",
      category: "feature_request",
      status: "not_started",
      product: "aura",
      createdAt: new Date().toISOString(),
      commentCount: 0,
      upvotes: 0,
      downvotes: 0,
      voteScore: 0,
      viewerVote: "none",
    };
    feedbackApiMock.create.mockResolvedValueOnce(dto);

    render(<NewFeedbackModal isOpen onClose={onClose} />);

    const post = screen.getByRole("button", { name: /post/i });
    expect(post).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Feedback body"), {
      target: { value: "Please add dark mode" },
    });
    expect(post).not.toBeDisabled();

    fireEvent.click(post);

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(feedbackApiMock.create).toHaveBeenCalled();
    expect(useFeedbackStore.getState().items[0]?.id).toBe("fb-1");
  });

  it("Cancel closes without calling the API", () => {
    const onClose = vi.fn();

    render(<NewFeedbackModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(feedbackApiMock.create).not.toHaveBeenCalled();
  });

  it("defaults the product to AURA even when the filter is on a different product", async () => {
    const onClose = vi.fn();
    const dto: FeedbackItemDto = {
      id: "fb-aura",
      profileId: "p1",
      eventType: "feedback",
      postType: "post",
      title: "t",
      summary: "body",
      category: "feature_request",
      status: "not_started",
      product: "aura",
      createdAt: new Date().toISOString(),
      commentCount: 0,
      upvotes: 0,
      downvotes: 0,
      voteScore: 0,
      viewerVote: "none",
    };
    feedbackApiMock.create.mockResolvedValueOnce(dto);
    useFeedbackStore.setState({ productFilter: "the_grid" });

    render(<NewFeedbackModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Feedback body"), {
      target: { value: "some feedback" },
    });
    fireEvent.click(screen.getByRole("button", { name: /post/i }));

    await vi.waitFor(() => {
      expect(feedbackApiMock.create).toHaveBeenCalled();
    });
    const [firstCallArgs] = feedbackApiMock.create.mock.calls;
    expect(firstCallArgs).toBeDefined();
    expect(firstCallArgs?.[0]).toMatchObject({
      product: "aura",
    });
  });
});
