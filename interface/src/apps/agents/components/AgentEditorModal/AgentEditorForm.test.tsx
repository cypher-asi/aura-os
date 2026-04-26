import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { act, renderHook } from "@testing-library/react";
import { AgentEditorForm, type AgentEditorFormProps } from "./AgentEditorForm";
import { useAgentEditorForm } from "./useAgentEditorForm";
import { api } from "../../../../api/client";
import type { Agent } from "../../../../shared/types";
import { emptyAgentPermissions } from "../../../../shared/types/permissions-wire";

vi.mock("@cypher-asi/zui", () => ({
  Input: ({ value, onChange, placeholder }: { value?: string; onChange?: (e: { target: { value: string } }) => void; placeholder?: string }) => (
    <input value={value} onChange={(e) => onChange?.({ target: { value: e.target.value } })} placeholder={placeholder} />
  ),
  Textarea: ({ value, onChange, placeholder }: { value?: string; onChange?: (e: { target: { value: string } }) => void; placeholder?: string }) => (
    <textarea value={value} onChange={(e) => onChange?.({ target: { value: e.target.value } })} placeholder={placeholder} />
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

function makeProps(overrides: Partial<AgentEditorFormProps> = {}): AgentEditorFormProps {
  return {
    name: "",
    setName: vi.fn(),
    role: "",
    setRole: vi.fn(),
    isSuperAgent: false,
    personality: "",
    setPersonality: vi.fn(),
    systemPrompt: "",
    setSystemPrompt: vi.fn(),
    icon: "",
    environment: "local_host",
    setEnvironment: vi.fn(),
    showAdvancedRuntime: false,
    setShowAdvancedRuntime: vi.fn(),
    listingStatus: "closed",
    setListingStatus: vi.fn(),
    simplifyForMobileCreate: false,
    restrictCreateToAuraRuntimes: true,
    nameError: "",
    setNameError: vi.fn(),
    nameRef: { current: null },
    fileInputRef: { current: null },
    error: "",
    handleFileSelect: vi.fn(),
    handleAvatarClick: vi.fn(),
    handleAvatarRemove: vi.fn(),
    ...overrides,
  };
}

describe("AgentEditorForm", () => {
  it("keeps runtime customization collapsed for the default Aura create flow", () => {
    render(<AgentEditorForm {...makeProps()} />);

    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.queryByText("Default Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
  });

  it("keeps mobile create focused on the remote Aura preset", () => {
    render(
      <AgentEditorForm
        {...makeProps({
          environment: "swarm_microvm",
          simplifyForMobileCreate: true,
        })}
      />,
    );

    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change runtime or credentials" })).not.toBeInTheDocument();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
  });

  it("does not expose org integration shortcuts during create", async () => {
    render(
      <AgentEditorForm
        {...makeProps({
          environment: "swarm_microvm",
          simplifyForMobileCreate: true,
          availableIntegrations: [
            {
              integration_id: "int-1",
              org_id: "org-1",
              name: "Primary Anthropic",
              provider: "anthropic",
              kind: "workspace_connection",
              has_secret: true,
              enabled: true,
              created_at: "2026-03-17T01:00:00.000Z",
              updated_at: "2026-03-17T01:00:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Use organization connection instead" })).not.toBeInTheDocument();
    expect(screen.queryByText("Primary Anthropic")).not.toBeInTheDocument();
    expect(screen.queryByText("Anthropic API")).not.toBeInTheDocument();
  });

  it("renders a read-only permissions summary for super-agents only", () => {
    const { rerender } = render(<AgentEditorForm {...makeProps()} />);
    expect(
      screen.queryByText(/CEO super-agent/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Where does this SuperAgent run\?/i),
    ).not.toBeInTheDocument();

    rerender(<AgentEditorForm {...makeProps({ isSuperAgent: true })} />);
    expect(
      screen.getByText(/CEO super-agent — full control/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Run on this computer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Run on Aura cloud/i)).not.toBeInTheDocument();
  });

  it("shows Runs On and Visibility controls in advanced mode", () => {
    render(
      <AgentEditorForm
        {...makeProps({
          restrictCreateToAuraRuntimes: false,
          environment: "local_host",
          showAdvancedRuntime: true,
        })}
      />,
    );

    expect(screen.getByText("Runs On")).toBeInTheDocument();
    expect(screen.getByText("Visibility")).toBeInTheDocument();
    expect(screen.queryByText("Credentials")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent Type")).not.toBeInTheDocument();
    expect(screen.queryByText("Default Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready to use")).not.toBeInTheDocument();
  });

  it("shows a System Prompt field below Personality", () => {
    render(<AgentEditorForm {...makeProps()} />);

    expect(screen.getByText("Personality")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Save-path purity: the editor must never inject system tags
// (host_mode:*, preset:*, migration:*) regardless of the agent shape.
// ---------------------------------------------------------------------------

const mockUseAuraCapabilities = vi.fn();
const mockOrgState = {
  activeOrg: { org_id: "org-1" },
  integrations: [] as unknown[],
  refreshIntegrations: vi.fn(),
};

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../../../hooks/use-modal-initial-focus", () => ({
  useModalInitialFocus: () => ({
    inputRef: { current: null },
    initialFocusRef: undefined,
  }),
}));

vi.mock("../../../../api/client", () => ({
  api: {
    agents: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../../../stores/org-store", () => ({
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
    tags: [],
    is_pinned: false,
    org_id: "org-1",
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    permissions: emptyAgentPermissions(),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useAgentEditorForm save payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    vi.mocked(api.agents.create).mockResolvedValue(makeAgent());
    vi.mocked(api.agents.update).mockResolvedValue(makeAgent());
  });

  it("never injects host_mode:*, preset:*, or migration:* tags on update", async () => {
    const legacy = makeAgent({
      tags: [
        "super_agent",
        "host_mode:harness",
        "preset:ceo",
        "migration:super_agent_v1",
        "listing_status:hireable",
        "team:frontend",
      ],
      listing_status: "hireable",
    });

    const { result } = renderHook(() =>
      useAgentEditorForm(true, legacy, vi.fn(), vi.fn()),
    );

    await act(async () => {
      await result.current.handleSave();
    });

    expect(api.agents.update).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(api.agents.update).mock.calls[0][1] as {
      tags?: string[];
    };
    const tags = payload.tags ?? [];
    expect(tags.some((t) => t.startsWith("host_mode:"))).toBe(false);
    expect(tags.some((t) => t.startsWith("preset:"))).toBe(false);
    expect(tags.some((t) => t.startsWith("migration:"))).toBe(false);
  });

  it("does not send any system tags on create and ships empty permissions", async () => {
    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setName("atlas");
      result.current.setRole("engineer");
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(api.agents.create).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(api.agents.create).mock.calls[0][0] as {
      tags?: string[];
      permissions: { capabilities: unknown[]; scope: unknown };
    };
    const tags = payload.tags ?? [];
    expect(tags.some((t) => t.startsWith("host_mode:"))).toBe(false);
    expect(tags.some((t) => t.startsWith("preset:"))).toBe(false);
    expect(tags.some((t) => t.startsWith("migration:"))).toBe(false);
    expect(payload.permissions).toBeDefined();
    expect(payload.permissions.capabilities).toEqual([]);
  });
});
