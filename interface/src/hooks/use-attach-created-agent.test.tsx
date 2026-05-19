import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { queryClient } from "../shared/lib/query-client";
import { projectQueryKeys } from "../queries/project-queries";
import { CREATE_AGENT_CHAT_HANDOFF } from "../utils/chat-handoff";
import type { AgentInstance } from "../shared/types";
import { useAttachCreatedAgent } from "./use-attach-created-agent";

const mockNavigate = vi.fn();
const mockSetAgentsByProject = vi.fn();
const mockRefreshProjectAgents = vi.fn().mockResolvedValue(undefined);
let mockPendingCreateAgentHandoff: { target: string; label?: string } | null = null;
const mockBeginCreateAgentHandoff = vi.fn((target: string, label?: string) => {
  mockPendingCreateAgentHandoff = { target, label };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../apps/projects/useProjectsList", () => ({
  useProjectsList: () => ({
    setAgentsByProject: mockSetAgentsByProject,
    refreshProjectAgents: mockRefreshProjectAgents,
  }),
}));

vi.mock("../stores/chat-handoff-store", () => ({
  useChatHandoffStore: (
    selector: (state: {
      pendingCreateAgentHandoff: typeof mockPendingCreateAgentHandoff;
      beginCreateAgentHandoff: typeof mockBeginCreateAgentHandoff;
    }) => unknown,
  ) =>
    selector({
      pendingCreateAgentHandoff: mockPendingCreateAgentHandoff,
      beginCreateAgentHandoff: mockBeginCreateAgentHandoff,
    }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function makeInstance(): AgentInstance {
  return {
    agent_instance_id: "ai-1",
    project_id: "p-1",
    agent_id: "a-1",
    name: "Standard Agent",
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
  };
}

describe("useAttachCreatedAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPendingCreateAgentHandoff = null;
    queryClient.clear();
  });

  it("writes the agent to the projects cache, begins the chat handoff, and navigates with create-agent state", () => {
    const { result } = renderHook(() => useAttachCreatedAgent(), { wrapper });

    const instance = makeInstance();
    act(() => {
      result.current(instance);
    });

    expect(mockSetAgentsByProject).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(projectQueryKeys.agentInstance("p-1", "ai-1"))).toEqual(
      instance,
    );
    expect(mockBeginCreateAgentHandoff).toHaveBeenCalledWith(
      "project:p-1:ai-1",
      "Standard Agent",
    );
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p-1/agents/ai-1", {
      state: { agentChatHandoff: { type: CREATE_AGENT_CHAT_HANDOFF } },
    });
    expect(mockRefreshProjectAgents).toHaveBeenCalledWith("p-1");
  });
});
