import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ProfileMainPanel } from "./ProfileMainPanel";

const mockSetSelectedProject = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Drawer: ({ children, isOpen }: { children?: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}));

vi.mock("../../../components/CommitGrid", () => ({
  CommitGrid: () => <div data-testid="commit-grid" />,
}));

vi.mock("../../../components/ActivityCard", () => ({
  ActivityCard: () => <div data-testid="activity-card" />,
}));

vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: true, isPhoneLayout: true }),
}));

vi.mock("../../../shared/hooks/use-delayed-loading", () => ({
  useDelayedLoading: () => false,
}));

vi.mock("../../../stores/profile-store", () => ({
  buildFilteredProfileEvents: () => [],
  buildProfileCommitActivity: () => [],
  getProfileCommentsForEvent: () => [],
  useProfileEvents: () => [],
  useProfileStore: (selector: (state: {
    init: () => void;
    projects: Array<{ id: string; name: string }>;
    projectsStatus: string;
    selectedProject: string | null;
    setSelectedProject: typeof mockSetSelectedProject;
    selectedEventId: string | null;
    selectEvent: () => void;
    comments: unknown[];
    eventsStatus: string;
  }) => unknown) =>
    selector({
      init: vi.fn(),
      projects: [
        { id: "p-long", name: "Very Long Mobile Project Name That Should Use Native Picker" },
        { id: "p-short", name: "Short Project" },
      ],
      projectsStatus: "loaded",
      selectedProject: null,
      setSelectedProject: mockSetSelectedProject,
      selectedEventId: null,
      selectEvent: vi.fn(),
      comments: [],
      eventsStatus: "loaded",
    }),
}));

vi.mock("../shared", () => ({
  getProfileEventDetail: () => "activity",
  ProfileActionGroup: () => <div data-testid="profile-actions" />,
  ProfileCommentsPanel: () => <div data-testid="profile-comments" />,
  ProfileSummaryCard: () => <div data-testid="profile-summary" />,
  useProfileSummaryModel: () => ({}),
}));

vi.mock("./ProfileMainPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("ProfileMainPanel mobile", () => {
  beforeEach(() => {
    mockSetSelectedProject.mockClear();
  });

  it("uses a native mobile activity picker instead of a wide chip rail", async () => {
    const user = userEvent.setup();
    render(<ProfileMainPanel />);

    const select = screen.getByLabelText("Filter profile activity");
    expect(select).toBeInTheDocument();
    expect(screen.queryByLabelText("Profile activity filter")).not.toBeInTheDocument();

    await user.selectOptions(select, "p-short");

    expect(mockSetSelectedProject).toHaveBeenCalledWith("p-short");
  });
});
