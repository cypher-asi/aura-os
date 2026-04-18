import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AgentInstance } from "../../types";
import { emptyAgentPermissions } from "../../types/permissions-wire";

const mockNavigate = vi.fn();
const mockRefreshProjectAgents = vi.fn();
const mockGetLastAgent = vi.fn();
const mockProjectsListState = {
  agentsByProject: {} as Record<string, AgentInstance[]>,
  refreshProjectAgents: mockRefreshProjectAgents,
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: typeof mockProjectsListState) => unknown) =>
    selector(mockProjectsListState),
}));

vi.mock("../../utils/storage", () => ({
  getLastAgent: (...args: unknown[]) => mockGetLastAgent(...args),
}));

vi.mock("../ProjectEmptyView", () => ({
  ProjectEmptyView: () => <div data-testid="project-empty-view" />,
}));

import { ProjectAgentRedirectView } from "./ProjectAgentRedirectView";

function makeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    agent_instance_id: "agent-1",
    project_id: "p1",
    agent_id: "template-1",
    org_id: "org-1",
    name: "Agent One",
    role: "dev",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    workspace_path: null,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    permissions: emptyAgentPermissions(),
    intent_classifier: null,
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1/agent"]}>
      <Routes>
        <Route path="/projects/:projectId/agent" element={<ProjectAgentRedirectView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectAgentRedirectView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectsListState.agentsByProject = {};
  });

  it("redirects to an active project agent when the last-used agent is archived", async () => {
    mockProjectsListState.agentsByProject = {
      p1: [
        makeAgent({
          agent_instance_id: "archived-agent",
          name: "Archived Agent",
          status: "archived",
        }),
        makeAgent({
          agent_instance_id: "active-agent",
          name: "Active Agent",
          status: "idle",
        }),
      ],
    };
    mockGetLastAgent.mockReturnValue("archived-agent");

    renderView();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/agents/active-agent", {
        replace: true,
      });
    });
  });

  it("shows the empty project view when only archived agents remain", async () => {
    mockProjectsListState.agentsByProject = {
      p1: [
        makeAgent({
          agent_instance_id: "archived-agent",
          name: "Archived Agent",
          status: "archived",
        }),
      ],
    };
    mockGetLastAgent.mockReturnValue("archived-agent");

    renderView();

    await waitFor(() => {
      expect(screen.getByTestId("project-empty-view")).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
