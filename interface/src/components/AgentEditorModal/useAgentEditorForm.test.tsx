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

  it("selects Gemini org integrations for the Gemini CLI runtime", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-gemini",
        provider: "google_gemini",
        default_model: "gemini-2.5-pro",
        name: "Gemini Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("gemini_cli");
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.integrationId).toBe("int-gemini");
    });
  });

  it("ignores unrelated tool integrations when choosing runtime auth", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-github",
        provider: "github",
        default_model: null,
        name: "GitHub Org",
      },
      {
        integration_id: "int-openai",
        provider: "openai",
        default_model: "gpt-5.1",
        name: "OpenAI Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("codex");
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.authSource).toBe("org_integration");
      expect(result.current.integrationId).toBe("int-openai");
    });
  });

  it("allows OpenCode to choose among multiple runtime-compatible integrations", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-linear",
        provider: "linear",
        default_model: null,
        name: "Linear Team",
      },
      {
        integration_id: "int-openrouter",
        provider: "openrouter",
        default_model: "openrouter/openai/gpt-4.1-mini",
        name: "OpenRouter Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("opencode");
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.integrationId).toBe("int-openrouter");
    });
  });

  it("allows OpenCode to use xAI workspace connections", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-xai",
        provider: "xai",
        default_model: "xai/grok-4",
        name: "xAI Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("opencode");
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.integrationId).toBe("int-xai");
    });
  });

  it("leaves runtime auth unselected when only non-runtime integrations exist", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-linear",
        provider: "linear",
        default_model: null,
        name: "Linear Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("codex");
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.authSource).toBe("org_integration");
      expect(result.current.integrationId).toBe("");
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

  it("keeps Cursor on local CLI auth even when model integrations exist", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-openai",
        provider: "openai",
        default_model: "gpt-5.1",
        name: "OpenAI Team",
      },
    ];

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setAdapterType("cursor");
      result.current.setAuthSource("org_integration");
    });

    await waitFor(() => {
      expect(result.current.authSource).toBe("local_cli_auth");
      expect(result.current.integrationId).toBe("");
    });
  });
});
