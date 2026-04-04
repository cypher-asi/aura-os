import { act, renderHook, waitFor } from "@testing-library/react";
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
  });

  it("defaults new desktop agents to local_host aura harness", () => {
    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    expect(result.current.adapterType).toBe("aura_harness");
    expect(result.current.environment).toBe("local_host");
    expect(result.current.authSource).toBe("aura_managed");
  });

  it("defaults new mobile agents to swarm microvm", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    expect(result.current.environment).toBe("swarm_microvm");
    expect(result.current.authSource).toBe("aura_managed");
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
  });

  it("falls back to a matching org integration when org-backed auth is selected", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-anthropic",
        provider: "anthropic",
        default_model: "claude-opus-4-6",
        name: "Anthropic Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("claude_code");
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.authSource).toBe("org_integration");
      expect(result.current.integrationId).toBe("int-anthropic");
    });
  });

  it("allows Aura to switch to an org-backed Anthropic integration", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-aura-anthropic",
        provider: "anthropic",
        default_model: "claude-opus-4-6",
        name: "Aura Anthropic",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.adapterType).toBe("aura_harness");
      expect(result.current.authSource).toBe("org_integration");
      expect(result.current.integrationId).toBe("int-aura-anthropic");
    });
  });
});
