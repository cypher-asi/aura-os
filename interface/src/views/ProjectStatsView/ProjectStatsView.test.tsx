import { render, screen } from "../../test/render";

const mockUseProjectContext = vi.fn();

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectContext(),
}));

vi.mock("../StatsDashboard", () => ({
  StatsDashboard: ({ variant }: { variant?: string }) => (
    <div data-testid="stats-dashboard" data-variant={variant ?? "sidekick"} />
  ),
}));

import { ProjectStatsView } from "./ProjectStatsView";
import { MobileProjectStatsScreen } from "../../mobile/screens/ProjectStatsScreen/ProjectStatsScreen";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectContext.mockReturnValue({
    project: { project_id: "proj-1" },
  });
});

describe("ProjectStatsView", () => {
  it("renders the mobile stats route with the mobile dashboard variant", () => {
    render(<MobileProjectStatsScreen />);

    expect(screen.getByText(/stats/i)).toBeInTheDocument();
    expect(screen.getByTestId("stats-dashboard")).toHaveAttribute("data-variant", "mobile");
  });

  it("falls back to the shared dashboard variant on desktop", () => {
    render(<ProjectStatsView />);

    expect(screen.getByTestId("stats-dashboard")).toHaveAttribute("data-variant", "sidekick");
  });
});
