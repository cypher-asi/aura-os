import { render, screen } from "@testing-library/react";

vi.mock("./ActivityCard.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../Avatar", () => ({
  Avatar: ({
    avatarUrl,
    name,
    onClick,
  }: {
    avatarUrl?: string;
    name?: string;
    onClick?: (event: React.MouseEvent) => void;
  }) => (
    <img
      alt={name ?? "avatar"}
      src={avatarUrl ?? ""}
      data-testid="avatar"
      onClick={onClick}
    />
  ),
}));

vi.mock("../../utils/format", () => ({
  timeAgo: () => "2d ago",
}));

import { ActivityCard } from "../ActivityCard";
import type { ActivityCardProps } from "../ActivityCard";

function makeProps(
  overrides: Partial<ActivityCardProps> = {},
): ActivityCardProps {
  return {
    event: {
      id: "evt-1",
      postType: "post",
      title: "Ship it",
      author: {
        name: "OS Test User",
        type: "user",
        avatarUrl: "https://example.com/avatar.png",
      },
      repo: "aura-os/interface",
      branch: "main",
      commits: [],
      commitIds: [],
      timestamp: "2025-06-01T12:00:00Z",
      summary: "Posted an update",
      eventType: "post",
      profileId: "profile-1",
      commentCount: 2,
    },
    isLast: false,
    isSelected: false,
    comments: [
      {
        id: "c1",
        eventId: "evt-1",
        author: {
          name: "Commenter One",
          type: "user",
          avatarUrl: "https://example.com/commenter-one.png",
        },
        text: "First",
        timestamp: "2025-06-01T13:00:00Z",
      },
      {
        id: "c2",
        eventId: "evt-1",
        author: {
          name: "Commenter Two",
          type: "agent",
          avatarUrl: "https://example.com/commenter-two.png",
        },
        text: "Second",
        timestamp: "2025-06-01T14:00:00Z",
      },
    ],
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe("ActivityCard", () => {
  it("shows a selected card state", () => {
    const { container } = render(<ActivityCard {...makeProps({ isSelected: true })} />);

    expect(container.firstElementChild).toHaveClass("card");
    expect(container.firstElementChild).toHaveClass("cardActive");
  });

  it("renders only the main author avatar alongside the comment count", () => {
    const { container } = render(<ActivityCard {...makeProps()} />);

    expect(screen.getByText("2 comments")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="avatar"]')).toHaveLength(1);
  });
});
