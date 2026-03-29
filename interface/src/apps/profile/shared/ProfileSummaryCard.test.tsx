import type { ReactNode } from "react";
import { render, screen } from "../../../test/render";
import userEvent from "@testing-library/user-event";

vi.mock("../../../components/EntityCard", () => ({
  EntityCard: ({
    children,
    fallbackIcon,
    name,
    subtitle,
    nameAction,
  }: {
    children?: ReactNode;
    fallbackIcon?: ReactNode;
    name: string;
    subtitle?: string;
    nameAction?: ReactNode;
  }) => (
    <div>
      <div>{fallbackIcon}</div>
      <div>{name}</div>
      <div>{subtitle}</div>
      <div>{nameAction}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("../../../components/FollowEditButton", () => ({
  FollowEditButton: () => <button type="button">Follow</button>,
}));

vi.mock("../ProfileEditorModal", () => ({
  ProfileEditorModal: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="profile-editor-modal">{String(isOpen)}</div>
  ),
}));

vi.mock("./profileShared", () => ({
  formatJoinedDate: () => "March 2026",
  formatTokenCount: (value: number) => String(value),
}));

vi.mock("./ProfileSummaryCard.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProfileSummaryCard } from "./ProfileSummaryCard";
import type { ProfileSummaryModel } from "./profileShared";

function makeSummary(overrides: Partial<ProfileSummaryModel> = {}): ProfileSummaryModel {
  return {
    profile: {
      id: "profile-1",
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

describe("ProfileSummaryCard", () => {
  it("uses buttons for editable placeholders and opens the editor", async () => {
    const user = userEvent.setup();
    const summary = makeSummary();

    render(<ProfileSummaryCard summary={summary} />);

    await user.click(screen.getByRole("button", { name: "Add a bio..." }));
    await user.click(screen.getByRole("button", { name: "Add location" }));
    await user.click(screen.getByRole("button", { name: "Add website" }));

    expect(summary.openEditor).toHaveBeenCalledTimes(3);
  });
});
