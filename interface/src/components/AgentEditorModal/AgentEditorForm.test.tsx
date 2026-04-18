import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentEditorForm, type AgentEditorFormProps } from "./AgentEditorForm";
import { mergeHostModeTag, HOST_MODE_HARNESS_TAG } from "./useAgentEditorForm";

vi.mock("../../api/core", () => ({
  apiFetch: vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ reachable: true, url: "http://localhost:8787", latency_ms: 5 }),
    } as unknown as Response),
  ),
}));

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
  });

  it("renders the Local/Cloud host toggle only for super-agents", () => {
    const { rerender } = render(<AgentEditorForm {...makeProps()} />);
    expect(
      screen.queryByText("Where does this SuperAgent run?"),
    ).not.toBeInTheDocument();

    rerender(
      <AgentEditorForm
        {...makeProps({
          isSuperAgent: true,
          hostMode: "local",
          setHostMode: vi.fn(),
        })}
      />,
    );
    expect(
      screen.getByText("Where does this SuperAgent run?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run on this computer")).toBeInTheDocument();
    expect(screen.getByText("Run on Aura cloud")).toBeInTheDocument();
  });

  it("invokes setHostMode when the user flips Local -> Cloud", () => {
    const setHostMode = vi.fn();
    render(
      <AgentEditorForm
        {...makeProps({
          isSuperAgent: true,
          hostMode: "local",
          setHostMode,
        })}
      />,
    );

    fireEvent.click(screen.getByText("Run on Aura cloud").closest("button")!);
    expect(setHostMode).toHaveBeenCalledWith("cloud");
  });

  it("shows runtime and credential controls for non-default setups", () => {
    render(
      <AgentEditorForm
        {...makeProps({
          restrictCreateToAuraRuntimes: false,
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

describe("mergeHostModeTag", () => {
  it("adds the harness tag when switching to cloud", () => {
    const next = mergeHostModeTag(["super_agent"], "cloud");
    expect(next).toEqual(["super_agent", HOST_MODE_HARNESS_TAG]);
  });

  it("removes the harness tag when switching to local", () => {
    const next = mergeHostModeTag(
      ["super_agent", HOST_MODE_HARNESS_TAG],
      "local",
    );
    expect(next).toEqual(["super_agent"]);
  });

  it("preserves unrelated tags verbatim", () => {
    const next = mergeHostModeTag(
      ["super_agent", "feature:beta", HOST_MODE_HARNESS_TAG],
      "local",
    );
    expect(next).toEqual(["super_agent", "feature:beta"]);
  });

  it("is idempotent when cloud is selected twice", () => {
    const first = mergeHostModeTag(["super_agent"], "cloud");
    const second = mergeHostModeTag(first, "cloud");
    expect(second).toEqual(first);
  });

  it("never mutates the input array", () => {
    const input = ["super_agent", HOST_MODE_HARNESS_TAG];
    const snapshot = [...input];
    mergeHostModeTag(input, "local");
    expect(input).toEqual(snapshot);
  });
});
