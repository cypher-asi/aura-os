import type { ReactNode } from "react";
import { render, screen } from "../../../../test/render";
import userEvent from "@testing-library/user-event";

const { mockAddComment, mockUseProfileCommentsForEvent } = vi.hoisted(() => ({
  mockAddComment: vi.fn(),
  mockUseProfileCommentsForEvent: vi.fn(),
}));

vi.mock("../../../../stores/profile-store", () => ({
  useProfileCommentsForEvent: (eventId: string) => mockUseProfileCommentsForEvent(eventId),
  useProfileStore: (selector: (state: { addComment: typeof mockAddComment }) => unknown) =>
    selector({ addComment: mockAddComment }),
}));

vi.mock("../../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("./ProfileCommentsPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProfileCommentsPanel } from "./ProfileCommentsPanel";

describe("ProfileCommentsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty state when no comments are loaded", () => {
    mockUseProfileCommentsForEvent.mockReturnValue([]);

    render(<ProfileCommentsPanel eventId="event-1" />);

    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("submits a new comment and clears the draft", async () => {
    const user = userEvent.setup();
    mockUseProfileCommentsForEvent.mockReturnValue([
      {
        id: "comment-1",
        eventId: "event-1",
        author: { name: "Teammate", type: "user" as const },
        text: "Looks good",
        timestamp: "2026-03-17T01:00:00.000Z",
      },
    ]);

    render(<ProfileCommentsPanel eventId="event-1" variant="drawer" />);

    await user.type(screen.getByLabelText("Comment"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Send comment" }));

    expect(mockAddComment).toHaveBeenCalledWith("event-1", "Ship it");
    expect(screen.getByLabelText("Comment")).toHaveValue("");
  });
});
