import { render, screen } from "../../test/render";

vi.mock("@cypher-asi/zui", () => ({
  Text: ({
    children,
    className,
    title,
  }: {
    children?: React.ReactNode;
    className?: string;
    title?: string;
    size?: string;
    variant?: string;
    align?: string;
  }) => <span className={className} title={title}>{children}</span>,
}));

const mockUseStatsDashboardData = vi.fn();
const mockUseDelayedEmpty = vi.fn();

vi.mock("../../shared/hooks/use-delayed-empty", () => ({
  useDelayedEmpty: (...args: unknown[]) => mockUseDelayedEmpty(...args),
}));

vi.mock("./useStatsDashboardData", () => ({
  useStatsDashboardData: () => mockUseStatsDashboardData(),
}));

vi.mock("../aura.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("./StatsDashboard.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { StatsDashboard } from "./StatsDashboard";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDelayedEmpty.mockReturnValue(true);
});

describe("StatsDashboard", () => {
  it("renders the empty state when stats are unavailable", () => {
    mockUseStatsDashboardData.mockReturnValue({ stats: null, loading: false });

    render(<StatsDashboard />);

    expect(screen.getByText("No project stats available")).toBeInTheDocument();
  });

  it("renders shared stats content in the mobile variant", () => {
    mockUseStatsDashboardData.mockReturnValue({
      loading: false,
      stats: {
        total_tasks: 12,
        pending_tasks: 2,
        ready_tasks: 3,
        in_progress_tasks: 2,
        blocked_tasks: 1,
        done_tasks: 3,
        failed_tasks: 1,
        completion_percentage: 58,
        total_tokens: 128_400,
        total_events: 42,
        total_agents: 2,
        total_sessions: 6,
        total_time_seconds: 4_380,
        lines_changed: 1_274,
        total_specs: 4,
        contributors: 3,
        estimated_cost_usd: 7.84,
      },
    });

    const { container } = render(<StatsDashboard variant="mobile" />);

    expect(screen.getByText("Completion")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByTitle("128,400")).toHaveTextContent("128K");
    expect(container.querySelector(".mobileStatsGrid")).not.toBeNull();
  });

  it("falls back cleanly when optional numeric fields are absent", () => {
    mockUseStatsDashboardData.mockReturnValue({
      loading: false,
      stats: {
        total_tasks: 0,
        pending_tasks: 0,
        ready_tasks: 0,
        in_progress_tasks: 0,
        blocked_tasks: 0,
        done_tasks: 0,
        failed_tasks: 0,
        completion_percentage: 0,
        total_tokens: 0,
        total_events: 34,
        total_agents: 1,
        total_sessions: 1,
        total_time_seconds: 0,
        lines_changed: 0,
        total_specs: 0,
        contributors: 1,
        estimated_cost_usd: undefined,
      },
    });

    render(<StatsDashboard variant="mobile" />);

    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
  });
});
