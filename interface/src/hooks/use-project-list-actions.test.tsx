import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { api } from "../api/client";
import { ApiClientError } from "../shared/api/core";
import { useProjectListActions } from "./use-project-list-actions";
import { CREATE_AGENT_CHAT_HANDOFF } from "../utils/chat-handoff";

const mockNavigate = vi.fn();
const mockRefreshProjects = vi.fn().mockResolvedValue(undefined);
const mockRefreshProjectAgents = vi.fn().mockResolvedValue(undefined);
const mockSetAgentsByProject = vi.fn();
const mockSetProjects = vi.fn();
let mockAgentsByProject: Record<string, Array<{ agent_instance_id: string; project_id: string; status: string }>> = {};
let mockPendingCreateAgentHandoff: { target: string; label?: string } | null = null;
const mockBeginCreateAgentHandoff = vi.fn((target: string, label?: string) => {
  mockPendingCreateAgentHandoff = { target, label };
});

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
    agentsByProject: mockAgentsByProject,
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
    createGeneralAgentInstance: vi.fn().mockResolvedValue({
      agent_instance_id: "general-ai",
      project_id: "p-9",
      agent_id: "general-a",
      name: "New Agent",
      role: "general",
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
    }),
    updateAgentInstance: vi.fn().mockResolvedValue({
      agent_instance_id: "ai-2",
      project_id: "p-2",
      agent_id: "a-2",
      name: "Archived Agent",
      role: "dev",
      personality: "",
      system_prompt: "",
      skills: [],
      icon: null,
      status: "archived",
      current_task_id: null,
      current_session_id: null,
      total_input_tokens: 0,
      total_output_tokens: 0,
      created_at: "",
      updated_at: "",
    }),
  },
  ApiClientError: class extends Error {
    status: number;
    body: { error: string; code: string; details: string | null };
    constructor(status: number, body: { error: string; code: string; details: string | null }) {
      super(body.error);
      this.name = "ApiClientError";
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock("../utils/storage", () => ({
  clearLastAgentIf: vi.fn(),
}));

vi.mock("../stores/chat-handoff-store", () => ({
  useChatHandoffStore: (selector: (state: {
    pendingCreateAgentHandoff: typeof mockPendingCreateAgentHandoff;
    beginCreateAgentHandoff: typeof mockBeginCreateAgentHandoff;
  }) => unknown) => selector({
    pendingCreateAgentHandoff: mockPendingCreateAgentHandoff,
    beginCreateAgentHandoff: mockBeginCreateAgentHandoff,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useProjectListActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentsByProject = {};
    mockPendingCreateAgentHandoff = null;
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

    expect(mockNavigate).toHaveBeenCalledWith("/projects/p-2/agents/new-ai", {
      state: {
        agentChatHandoff: {
          type: CREATE_AGENT_CHAT_HANDOFF,
        },
      },
    });
    expect(mockRefreshProjectAgents).toHaveBeenCalledWith("p-2");
    expect(mockSetAgentsByProject).toHaveBeenCalled();
  });

  it("keeps the selector open until the created agent handoff completes", () => {
    const { result, rerender } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.handleAddAgent("p-1");
      result.current.handleAgentCreated({
        agent_instance_id: "ai-1",
        project_id: "p-1",
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

    expect(result.current.agentSelectorProjectId).toBe("p-1");
    expect(result.current.pendingCreatedAgent?.agent_instance_id).toBe("ai-1");

    mockPendingCreateAgentHandoff = null;
    rerender();

    expect(result.current.agentSelectorProjectId).toBeNull();
    expect(result.current.pendingCreatedAgent).toBeNull();
  });

  it("handleQuickAddAgent creates a general agent and navigates to it", async () => {
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    await act(async () => {
      await result.current.handleQuickAddAgent("p-9");
    });

    expect(api.createGeneralAgentInstance).toHaveBeenCalledWith("p-9");
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p-9/agents/general-ai", {
      state: {
        agentChatHandoff: {
          type: CREATE_AGENT_CHAT_HANDOFF,
        },
      },
    });
  });

  it("handleArchiveAgent archives the target instance locally", async () => {
    mockAgentsByProject = {
      "p-2": [
        {
          agent_instance_id: "ai-2",
          project_id: "p-2",
          status: "idle",
        },
      ],
    };
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    await act(async () => {
      await result.current.handleArchiveAgent({
        agent_instance_id: "ai-2",
        project_id: "p-2",
        agent_id: "a-2",
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

    expect(api.updateAgentInstance).not.toHaveBeenCalled();
    expect(mockSetAgentsByProject).toHaveBeenCalled();
    const updater = mockSetAgentsByProject.mock.calls[0]?.[0] as
      | ((prev: typeof mockAgentsByProject) => typeof mockAgentsByProject)
      | undefined;
    expect(updater).toBeTypeOf("function");
    const nextState = updater?.(mockAgentsByProject);
    expect(nextState?.["p-2"]?.[0]?.status).toBe("archived");
  });

  it("surfaces the unwrapped conflict message when deleting a project with agents", async () => {
    const nestedBody = JSON.stringify({
      error: {
        code: "BAD_REQUEST",
        message:
          "Bad request: Cannot delete project with existing project agents. Delete all project agents first.",
      },
    });
    (api.deleteProject as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError(400, { error: nestedBody, code: "network_error", details: null }),
    );

    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.setDeleteTarget({
        project_id: "p-1",
        org_id: "o-1",
        name: "My Project",
        description: "",
        current_status: "active",
        created_at: "",
        updated_at: "",
      });
    });

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(result.current.deleteError).toBe(
      "Cannot delete project with existing project agents. Delete all project agents first.",
    );
  });

  it("surfaces the unwrapped conflict message when deleting an agent instance", async () => {
    mockAgentsByProject = {
      "p-1": [
        { agent_instance_id: "ai-1", project_id: "p-1", status: "idle" },
      ],
    };
    const nestedBody = JSON.stringify({
      error: {
        code: "BAD_REQUEST",
        message: "Bad request: Cannot remove agent instance while it is running.",
      },
    });
    (api.deleteAgentInstance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError(400, { error: nestedBody, code: "storage_error", details: null }),
    );

    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.setDeleteAgentTarget({
        agent_instance_id: "ai-1",
        project_id: "p-1",
        agent_id: "a-1",
        name: "Runner",
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

    await act(async () => {
      await result.current.handleDeleteAgent();
    });

    expect(result.current.deleteAgentError).toBe(
      "Cannot remove agent instance while it is running.",
    );
  });

  it("handleRenameAgent updates the agent name and clears the target", async () => {
    (api.updateAgentInstance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      agent_instance_id: "ai-1",
      project_id: "p-1",
      agent_id: "a-1",
      name: "Renamed Agent",
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

    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.setRenameAgentTarget({
        agent_instance_id: "ai-1",
        project_id: "p-1",
        agent_id: "a-1",
        name: "Old Name",
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

    expect(result.current.renameAgentTarget?.agent_instance_id).toBe("ai-1");

    await act(async () => {
      await result.current.handleRenameAgent("  Renamed Agent  ");
    });

    expect(api.updateAgentInstance).toHaveBeenCalledWith("p-1", "ai-1", { name: "Renamed Agent" });
    expect(mockSetAgentsByProject).toHaveBeenCalled();
    expect(result.current.renameAgentTarget).toBeNull();
  });

  it("handleRenameAgent skips the API call when the name is unchanged or empty", async () => {
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.setRenameAgentTarget({
        agent_instance_id: "ai-1",
        project_id: "p-1",
        agent_id: "a-1",
        name: "Same Name",
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

    await act(async () => {
      await result.current.handleRenameAgent("   Same Name   ");
    });

    expect(api.updateAgentInstance).not.toHaveBeenCalled();
    expect(result.current.renameAgentTarget).toBeNull();
  });

  it("handleProjectSaved updates the projects list", () => {
    const { result } = renderHook(() => useProjectListActions(), { wrapper });

    act(() => {
      result.current.handleProjectSaved({
        project_id: "p-1",
        org_id: "o-1",
        name: "Updated",
        description: "",
        current_status: "active",
        created_at: "",
        updated_at: "",
      });
    });

    expect(mockSetProjects).toHaveBeenCalled();
    expect(result.current.settingsTarget).toBeNull();
  });
});
