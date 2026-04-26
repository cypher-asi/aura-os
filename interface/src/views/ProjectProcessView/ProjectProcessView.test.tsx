import { render, screen, waitFor } from "../../test/render";
import { Route, Routes } from "react-router-dom";

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children?: React.ReactNode; variant?: string }) => <span>{children}</span>,
}));

const mockUseProjectActions = vi.fn();
const mockUseAuraCapabilities = vi.fn();
const mockUseProcessStore = vi.fn();

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectActions(),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../apps/process/stores/process-store", () => ({
  useProcessStore: (selector: (state: any) => unknown) => selector(mockUseProcessStore()),
}));

vi.mock("../../components/TaskStatusIcon", () => ({
  TaskStatusIcon: ({ status }: { status: string }) => <span data-testid={`run-status-${status}`} />,
}));

vi.mock("./ProjectProcessView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectProcessView } from "./ProjectProcessView";
import { MobileProjectProcessScreen } from "../../mobile/screens/ProjectProcessScreen/ProjectProcessScreen";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectActions.mockReturnValue({
    project: { project_id: "proj-1" },
  });
  mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
  mockUseProcessStore.mockReturnValue({
    processes: [{
      process_id: "proc-1",
      project_id: "proj-1",
      name: "Nightly QA",
      description: "Run nightly checks",
      enabled: true,
      folder_id: null,
      schedule: "Nightly",
      tags: [],
      last_run_at: "2026-03-17T01:00:00.000Z",
      next_run_at: "2026-03-18T01:00:00.000Z",
      org_id: "org-1",
      user_id: "user-1",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    }],
    runs: {
      "proc-1": [{
        run_id: "run-1",
        process_id: "proc-1",
        status: "running",
        trigger: "manual",
        error: null,
        started_at: "2026-03-17T01:00:00.000Z",
        completed_at: null,
      }],
    },
    loading: false,
    fetchProcesses: vi.fn().mockResolvedValue(undefined),
    fetchRuns: vi.fn().mockResolvedValue(undefined),
  });
});

describe("ProjectProcessView", () => {
  it("renders the mobile process monitor", async () => {
    render(
      <Routes>
        <Route path="/projects/:projectId/process" element={<ProjectProcessView />} />
        <Route path="/mobile/projects/:projectId/process" element={<MobileProjectProcessScreen />} />
      </Routes>,
      { routerProps: { initialEntries: ["/mobile/projects/proj-1/process"] } },
    );

    expect(screen.getByText("Project automations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nightly QA/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Recent runs")).toBeInTheDocument());
  });

  it("redirects desktop layouts back to the shared process app", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    render(
      <Routes>
        <Route path="/projects/:projectId/process" element={<ProjectProcessView />} />
        <Route path="/process" element={<div>Desktop process destination</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/process"] } },
    );

    expect(screen.getByText("Desktop process destination")).toBeInTheDocument();
  });
});
