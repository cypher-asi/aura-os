import type React from "react";
import { render, screen } from "../../test/render";
import type { Agent } from "../../types";
import { AgentSelectorModal } from "./AgentSelectorModal";

const mockUseAuraCapabilities = vi.fn();
const mockUseAgentSelectorData = vi.fn();
const mockUseProjectsListStore = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    footer,
    children,
  }: {
    isOpen: boolean;
    title: string;
    footer?: React.ReactNode;
    children?: React.ReactNode;
  }) => (isOpen ? <div><h1>{title}</h1>{children}{footer}</div> : null),
  Drawer: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children?: React.ReactNode;
  }) => (isOpen ? <div><h1>{title}</h1>{children}</div> : null),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Spinner: () => <div>Loading</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("./useAgentSelectorData", () => ({
  useAgentSelectorData: (...args: unknown[]) => mockUseAgentSelectorData(...args),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { agentsByProject: Record<string, Array<{ agent_id: string }>> }) => unknown) =>
    selector(mockUseProjectsListStore()),
}));

vi.mock("../EmptyState", () => ({
  EmptyState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../AgentEditorModal", () => ({
  AgentEditorModal: () => null,
}));

vi.mock("./AgentSelectorModal.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

function makeAgent(name: string, machineType: string): Agent {
  return {
    agent_id: name.toLowerCase().replace(/\s+/g, "-") as Agent["agent_id"],
    user_id: "user-1",
    name,
    role: "",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: machineType,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("AgentSelectorModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    mockUseProjectsListStore.mockReturnValue({ agentsByProject: {} });
    mockUseAgentSelectorData.mockReturnValue({
      agents: [makeAgent("Local Agent", "local"), makeAgent("Remote Agent", "remote")],
      loading: false,
      creating: null,
      error: "",
      showEditor: false,
      setShowEditor: vi.fn(),
      handleSelect: vi.fn(),
      handleAgentSaved: vi.fn(),
      handleClose: vi.fn(),
    });
  });

  it("shows both local and remote agents on desktop", () => {
    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Local Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Remote Agent").length).toBeGreaterThan(0);
  });

  it("shows only remote agents on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.queryByText("Local Agent")).not.toBeInTheDocument();
    expect(screen.getAllByText("Remote Agent").length).toBeGreaterThan(0);
    expect(screen.getByText("Add Remote Agent to Project")).toBeInTheDocument();
  });

  it("hides agents that are already attached to the project", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    mockUseProjectsListStore.mockReturnValue({
      agentsByProject: {
        "project-1": [{ agent_id: "remote-agent" }],
      },
    });

    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.queryByText("Remote Agent")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create agent" })).toBeInTheDocument();
  });
});
