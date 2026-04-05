import type { ReactNode } from "react";
import { render, screen } from "../../../../test/render";
import userEvent from "@testing-library/user-event";

vi.mock("../../../../components/FollowEditButton", () => ({
  FollowEditButton: ({
    targetProfileId,
    size,
    className,
  }: {
    targetProfileId?: string;
    size?: string;
    className?: string;
    children?: ReactNode;
  }) => (
    <button type="button" data-testid="follow-button" data-size={size} data-target={targetProfileId} className={className}>
      Follow
    </button>
  ),
}));

vi.mock("./ProfileActionGroup.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProfileActionGroup } from "./ProfileActionGroup";
import type { ProfileSummaryModel } from "../profileShared";

function makeSummary(overrides: Partial<ProfileSummaryModel> = {}): ProfileSummaryModel {
  return {
    profile: {
      name: "Test User",
      handle: "@test-user",
      bio: "",
      website: "",
      location: "",
      joinedDate: "2026-03-17T01:00:00.000Z",
    },
    updateProfile: vi.fn(),
    isOwnProfile: true,
    totalCommits: 0,
    projectCount: 0,
    totalTokenUsage: 0,
    followTargetId: "profile-1",
    editorOpen: false,
    openEditor: vi.fn(),
    closeEditor: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

describe("ProfileActionGroup", () => {
  it("renders owner actions in the stacked mobile layout", async () => {
    const user = userEvent.setup();
    const summary = makeSummary();

    render(<ProfileActionGroup summary={summary} variant="stacked" />);

    await user.click(screen.getByRole("button", { name: "Edit profile" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(summary.openEditor).toHaveBeenCalledOnce();
    expect(summary.logout).toHaveBeenCalledOnce();
  });

  it("renders a touch-sized follow action for non-owners", () => {
    render(
      <ProfileActionGroup
        summary={makeSummary({ isOwnProfile: false })}
        variant="stacked"
      />,
    );

    expect(screen.getByTestId("follow-button")).toHaveAttribute("data-size", "touch");
    expect(screen.getByTestId("follow-button")).toHaveAttribute("data-target", "profile-1");
  });
});
