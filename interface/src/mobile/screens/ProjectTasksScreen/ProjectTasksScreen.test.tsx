import { render, screen } from "../../../test/render";
import { Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

const mockUseProjectActions = vi.fn();
const mockUseProjectsListStore = vi.fn();
const mockUseSidekickStore = vi.fn();
const mockUseMobileTasks = vi.fn();

vi.mock("../../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectActions(),
}));

vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: any) => unknown) => selector(mockUseProjectsListStore()),
}));

vi.mock("../../../stores/sidekick-store", () => ({
  useSidekickStore: (selector: (state: any) => unknown) => selector(mockUseSidekickStore()),
}));

vi.mock("../../hooks/useMobileTasks", () => ({
  useMobileTasks: (projectId: string) => mockUseMobileTasks(projectId),
}));

vi.mock("../../../components/TaskStatusIcon", () => ({
  TaskStatusIcon: ({ status }: { status: string }) => <span data-testid={`task-status-${status}`} />,
}));

vi.mock("./ProjectTasksScreen.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { MobileProjectTasksScreen } from "./ProjectTasksScreen";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectActions.mockReturnValue({
    project: { project_id: "proj-1" },
    initialSpecs: [{ spec_id: "spec-1", title: "Spec One" }],
  });
  mockUseProjectsListStore.mockReturnValue({
    agentsByProject: {
      "proj-1": [{ agent_instance_id: "agent-inst-1", name: "Builder Bot" }],
    },
  });
  mockUseSidekickStore.mockReturnValue({ viewTask: vi.fn() });
  mockUseMobileTasks.mockReturnValue({
    tasks: [{
      task_id: "task-1",
      project_id: "proj-1",
      spec_id: "spec-1",
      title: "Patch auth flow",
      description: "Fix the login handoff",
      status: "ready",
      order_index: 0,
      dependency_ids: [],
      parent_task_id: null,
      assigned_agent_instance_id: "agent-inst-1",
      completed_by_agent_instance_id: null,
      session_id: null,
      execution_notes: "",
      files_changed: [],
      live_output: "",
      total_input_tokens: 0,
      total_output_tokens: 0,
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    }],
    liveTaskIds: new Set<string>(),
    loopActive: false,
  });
});

describe("MobileProjectTasksScreen", () => {
  it("renders the mobile task route with attention-focused copy", () => {
    render(
      <Routes>
        <Route path="/projects/:projectId/tasks" element={<MobileProjectTasksScreen />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/tasks"] } },
    );

    expect(screen.getByText("What needs attention")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Ready/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Open task Patch auth flow/i })).toBeInTheDocument();
  });

  it("lets people select an empty segment and see the empty state", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/tasks" element={<MobileProjectTasksScreen />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/tasks"] } },
    );

    await user.click(screen.getByRole("tab", { name: /Blocked/i }));

    expect(screen.getByRole("tab", { name: /Blocked/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Nothing here right now")).toBeInTheDocument();
  });

  it("uses the route project id when project context has not resolved yet", () => {
    mockUseProjectActions.mockReturnValue(null);

    render(
      <Routes>
        <Route path="/projects/:projectId/tasks" element={<MobileProjectTasksScreen />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-from-route/tasks"] } },
    );

    expect(mockUseMobileTasks).toHaveBeenCalledWith("proj-from-route");
    expect(screen.getByText("What needs attention")).toBeInTheDocument();
  });
});
