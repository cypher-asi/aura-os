import { render, screen } from "../../test/render";

const mockUseProjectContext = vi.fn();
const mockUseAuraCapabilities = vi.fn();

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectContext(),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../StatsDashboard", () => ({
  StatsDashboard: ({ variant }: { variant?: string }) => (
    <div data-testid="stats-dashboard" data-variant={variant ?? "sidekick"} />
  ),
}));

vi.mock("./ProjectStatsView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectStatsView } from "./ProjectStatsView";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectContext.mockReturnValue({
    project: { project_id: "proj-1" },
  });
});

describe("ProjectStatsView", () => {
  it("renders the mobile stats route with the mobile dashboard variant", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isStandalone: true });

    render(<ProjectStatsView />);

    expect(screen.getByText(/stats/i)).toBeInTheDocument();
    expect(screen.getByTestId("stats-dashboard")).toHaveAttribute("data-variant", "mobile");
  });

  it("falls back to the shared dashboard variant on desktop", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false, isStandalone: false });

    render(<ProjectStatsView />);

    expect(screen.getByTestId("stats-dashboard")).toHaveAttribute("data-variant", "sidekick");
  });
});
