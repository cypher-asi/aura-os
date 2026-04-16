import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { AgentEditorForm, type AgentEditorFormProps } from "./AgentEditorForm";

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
    adapterType: "aura_harness",
    setAdapterType: vi.fn(),
    environment: "local_host",
    setEnvironment: vi.fn(),
    authSource: "aura_managed",
    setAuthSource: vi.fn(),
    showAdvancedRuntime: false,
    setShowAdvancedRuntime: vi.fn(),
    integrationId: "",
    setIntegrationId: vi.fn(),
    defaultModel: "",
    setDefaultModel: vi.fn(),
    simplifyForMobileCreate: false,
    restrictCreateToAuraRuntimes: true,
    availableIntegrations: [],
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

  it("shows runtime and credential controls for non-default setups", () => {
    render(
      <AgentEditorForm
        {...makeProps({
          restrictCreateToAuraRuntimes: false,
          adapterType: "aura_harness",
          environment: "local_host",
          authSource: "aura_managed",
          showAdvancedRuntime: true,
        })}
      />,
    );

    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getByText("Runs On")).toBeInTheDocument();
    expect(screen.getByText("AURA Proxy")).toBeInTheDocument();
  });
});
