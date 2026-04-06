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

    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByText("Agent Type")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change runtime or credentials" })).toBeInTheDocument();
    expect(screen.queryByText("Default Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
  });

  it("shows runtime and credential controls for non-default setups", () => {
    render(
      <AgentEditorForm
        {...makeProps({
          adapterType: "codex",
          environment: "local_host",
          authSource: "local_cli_auth",
          showAdvancedRuntime: true,
        })}
      />,
    );

    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getByText("Runs On")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });
});
