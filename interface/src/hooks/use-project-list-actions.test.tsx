import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useProjectListActions } from "./use-project-list-actions";

const mockNavigate = vi.fn();
const mockRefreshProjects = vi.fn().mockResolvedValue(undefined);
const mockRefreshProjectAgents = vi.fn().mockResolvedValue(undefined);
const mockSetAgentsByProject = vi.fn();
const mockSetProjects = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ projectId: "p-1", agentInstanceId: "ai-1" }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../apps/projects/useProjectsList", () => ({
  useProjectsList: () => ({
    agentsByProject: {},
    setAgentsByProject: mockSetAgentsByProject,
    refreshProjects: mockRefreshProjects,
    refreshProjectAgents: mockRefreshProjectAgents,
    setProjects: mockSetProjects,
  }),
}));

vi.mock("../api/client", () => ({
  api: {
    updateProject: vi.fn().mockResolvedValue({}),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    deleteAgentInstance: vi.fn().mockResolvedValue(undefined),
  },
  ApiClientError: class extends Error {
    body: { error: string };
    constructor(msg: string) {
      super(msg);
      this.body = { error: msg };
    }
  },
}));

vi.mock("../utils/storage", () => ({
  clearLastAgentIf: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useProjectListActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial state with all null targets", () => {
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    expect(result.current.ctxMenu).toBeNull();
    expect(result.current.renameTarget).toBeNull();
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.settingsTarget).toBeNull();
    expect(result.current.deleteAgentTarget).toBeNull();
    expect(result.current.agentSelectorProjectId).toBeNull();
  });

  it("handleAddAgent sets agentSelectorProjectId", () => {
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.handleAddAgent("proj-99");
    });

    expect(result.current.agentSelectorProjectId).toBe("proj-99");
  });

  it("handleAgentCreated navigates to the new agent", () => {
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.handleAgentCreated({
        agent_instance_id: "new-ai",
        project_id: "p-2",
        agent_id: "a-1",
        name: "Agent",
        role: "dev",
        personality: "",
        system_prompt: "",
        skills: [],
        icon: null,
        status: "idle",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: "",
        updated_at: "",
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith("/projects/p-2/agents/new-ai");
    expect(mockRefreshProjectAgents).toHaveBeenCalledWith("p-2");
  });

  it("handleProjectSaved updates the projects list", () => {
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.handleProjectSaved({
        project_id: "p-1",
        org_id: "o-1",
        name: "Updated",
        description: "",
        linked_folder_path: "",
        current_status: "active",
        created_at: "",
        updated_at: "",
      });
    });

    expect(mockSetProjects).toHaveBeenCalled();
    expect(result.current.settingsTarget).toBeNull();
  });
});
