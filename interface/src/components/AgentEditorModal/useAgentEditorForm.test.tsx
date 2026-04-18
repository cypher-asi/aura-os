import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "../../api/client";
import type { Agent } from "../../types";
import { useAgentEditorForm } from "./useAgentEditorForm";

const mockUseAuraCapabilities = vi.fn();
const mockOrgState = {
  activeOrg: null,
  integrations: [] as Array<{
    integration_id: string;
    provider: string;
    default_model?: string | null;
    name: string;
  }>,
};

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../hooks/use-modal-initial-focus", () => ({
  useModalInitialFocus: () => ({
    inputRef: { current: null },
    initialFocusRef: undefined,
  }),
}));

vi.mock("../../api/client", () => ({
  api: {
    agents: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../stores/org-store", () => ({
  useOrgStore: (selector: (state: typeof mockOrgState) => unknown) =>
    selector(mockOrgState),
}));

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    agent_id: "agent-1" as Agent["agent_id"],
    user_id: "user-1",
    name: "Atlas",
    role: "Builder",
    personality: "Calm",
    system_prompt: "Help out",
    skills: [],
    icon: null,
    org_id: "org-1",
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useAgentEditorForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    mockOrgState.integrations = [];
    vi.mocked(api.agents.create).mockResolvedValue(makeAgent());
    vi.mocked(api.agents.update).mockResolvedValue(makeAgent());
  });

  it("defaults new desktop agents to local_host aura harness", () => {
    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    expect(result.current.adapterType).toBe("aura_harness");
    expect(result.current.environment).toBe("local_host");
    expect(result.current.authSource).toBe("aura_managed");
    expect(result.current.showAdvancedRuntime).toBe(false);
  });

  it("defaults new mobile agents to swarm microvm", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    expect(result.current.environment).toBe("swarm_microvm");
    expect(result.current.authSource).toBe("aura_managed");
    expect(result.current.showAdvancedRuntime).toBe(false);
  });

  it("preserves an existing agent environment while editing on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    const { result } = renderHook(() =>
      useAgentEditorForm(true, makeAgent({ machine_type: "local", environment: "local_host" }), vi.fn(), vi.fn()),
    );

    expect(result.current.environment).toBe("local_host");
  });

  it("defaults external adapters to local CLI auth", () => {
    const { result } = renderHook(() =>
      useAgentEditorForm(true, makeAgent({ adapter_type: "claude_code", environment: "local_host", auth_source: "local_cli_auth" }), vi.fn(), vi.fn()),
    );

    expect(result.current.adapterType).toBe("claude_code");
    expect(result.current.authSource).toBe("local_cli_auth");
    expect(result.current.showAdvancedRuntime).toBe(true);
  });

  it("keeps editing a default Aura agent collapsed by default", () => {
    const { result } = renderHook(() =>
      useAgentEditorForm(
        true,
        makeAgent({
          adapter_type: "aura_harness",
          environment: "local_host",
          auth_source: "aura_managed",
          integration_id: null,
          default_model: null,
        }),
        vi.fn(),
        vi.fn(),
      ),
    );

    expect(result.current.showAdvancedRuntime).toBe(false);
  });

  it("preserves existing org integration auth while editing a harness agent", () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-1",
        provider: "anthropic",
        default_model: "claude-sonnet-4-6",
        name: "Anthropic Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(
        true,
        makeAgent({
          adapter_type: "aura_harness",
          auth_source: "org_integration",
          integration_id: "int-1",
        }),
        vi.fn(),
        vi.fn(),
      ),
    );

    expect(result.current.authSource).toBe("org_integration");
    expect(result.current.integrationId).toBe("int-1");
  });

  it("keeps new agents pinned to Aura-managed billing and Aura runtimes", async () => {
    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("claude_code");
      result.current.setAuthSource("org_integration");
      result.current.setIntegrationId("int-anthropic");
      result.current.setDefaultModel("claude-opus-4-6");
    });

    await waitFor(() => {
      expect(result.current.adapterType).toBe("aura_harness");
      expect(result.current.authSource).toBe("aura_managed");
      expect(result.current.integrationId).toBe("");
      expect(result.current.defaultModel).toBe("");
    });
  });

  it("normalizes a legacy org-backed aura agent back to aura-managed auth", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-anthropic",
        provider: "anthropic",
        default_model: "claude-opus-4-6",
        name: "Anthropic Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(
        true,
        makeAgent({
          adapter_type: "aura_harness",
          environment: "swarm_microvm",
          auth_source: "org_integration",
          integration_id: "int-anthropic",
        }),
        vi.fn(),
        vi.fn(),
      ),
    );

    await waitFor(() => {
      expect(result.current.authSource).toBe("aura_managed");
      expect(result.current.integrationId).toBe("");
      expect(result.current.restrictCreateToAuraRuntimes).toBe(false);
    });
  });

  it("blocks creating a new agent when the name contains spaces", async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), onSaved),
    );

    act(() => {
      result.current.setName("Atlas Scout");
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.nameError).toBe(
      "Use only letters, numbers, hyphens, or underscores",
    );
    expect(api.agents.create).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("allows saving a legacy agent with spaces when the name is unchanged", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const legacyAgent = makeAgent({ name: "Atlas Scout" });
    vi.mocked(api.agents.update).mockResolvedValue(legacyAgent);

    const { result } = renderHook(() =>
      useAgentEditorForm(true, legacyAgent, onClose, onSaved),
    );

    act(() => {
      result.current.setRole("Senior Builder");
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.nameError).toBe("");
    expect(api.agents.update).toHaveBeenCalledWith(
      legacyAgent.agent_id,
      expect.objectContaining({
        name: "Atlas Scout",
        role: "Senior Builder",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("can keep the modal open after save when closeOnSave is disabled", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, onClose, onSaved, false),
    );

    act(() => {
      result.current.setName("Atlas");
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(onSaved).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
