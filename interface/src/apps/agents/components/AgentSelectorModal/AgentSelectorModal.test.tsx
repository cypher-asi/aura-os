import type React from "react";
import { fireEvent, render, screen } from "../../../../test/render";
import type { Agent } from "../../../../shared/types";
import { AgentSelectorModal } from "./AgentSelectorModal";

const mockUseAuraCapabilities = vi.fn();
const mockUseAgentSelectorData = vi.fn();
const mockUseProjectsListStore = vi.fn();
const mockHandleSelect = vi.fn();
const mockHandleSelectStandard = vi.fn();
const mockHandleClose = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children?: React.ReactNode;
  }) => (isOpen ? <div><h1>{title}</h1>{children}</div> : null),
  Drawer: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children?: React.ReactNode;
  }) => (isOpen ? <div><h1>{title}</h1>{children}</div> : null),
  Input: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
    ...rest
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      {...rest}
    />
  ),
  Spinner: () => <div>Loading</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  Sparkles: () => <span data-testid="icon-sparkles" />,
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("./useAgentSelectorData", () => ({
  useAgentSelectorData: (...args: unknown[]) => mockUseAgentSelectorData(...args),
  STANDARD_AGENT_CREATING_KEY: "__standard_agent__",
}));

vi.mock("../../../../hooks/use-avatar-state", () => ({
  useAvatarState: () => ({ status: undefined, isLocal: false }),
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { agentsByProject: Record<string, Array<{ agent_id: string }>> }) => unknown) =>
    selector(mockUseProjectsListStore()),
}));

vi.mock("../../../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
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

function setDataMock(overrides: Record<string, unknown> = {}) {
  mockUseAgentSelectorData.mockReturnValue({
    agents: [makeAgent("Local Agent", "local"), makeAgent("Remote Agent", "remote")],
    loading: false,
    creating: null,
    error: "",
    handleSelect: mockHandleSelect,
    handleSelectStandard: mockHandleSelectStandard,
    handleClose: mockHandleClose,
    showEditor: false,
    setShowEditor: vi.fn(),
    handleAgentSaved: vi.fn(),
    failedIcons: new Set<string>(),
    setFailedIcons: vi.fn(),
    ...overrides,
  });
}

describe("AgentSelectorModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    mockUseProjectsListStore.mockReturnValue({ agentsByProject: {} });
    setDataMock();
  });

  it("renders the Standard Agent row at the top with the search input", () => {
    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Select an agent" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search agents")).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Standard Agent");
    expect(options[1]).toHaveTextContent("Local Agent");
    expect(options[2]).toHaveTextContent("Remote Agent");
  });

  it("shows only remote agents on mobile and uses the mobile drawer title", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Add agent" })).toBeInTheDocument();
    expect(screen.queryByText("Local Agent")).not.toBeInTheDocument();
    // The Avatar mock and the row both render the agent name, so use
    // option count instead — Standard + Remote = 2.
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getAllByText("Remote Agent").length).toBeGreaterThan(0);
  });

  it("hides local agents when remote-only (web/mobile, no desktop bridge)", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false, remoteOnly: true });

    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.queryByText("Local Agent")).not.toBeInTheDocument();
    // Standard + Remote = 2.
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("hides agents already attached to the project", () => {
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
    expect(screen.getByText("Standard Agent")).toBeInTheDocument();
    expect(screen.getAllByText("Local Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("filters the list by query and resets the highlight to the top", () => {
    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const search = screen.getByLabelText("Search agents") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "Remote" } });

    expect(screen.queryByText("Standard Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Local Agent")).not.toBeInTheDocument();
    expect(screen.getAllByText("Remote Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("activates the highlighted row with arrow-down + enter", () => {
    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const search = screen.getByLabelText("Search agents");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(mockHandleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: "local-agent" }),
    );
    expect(mockHandleSelectStandard).not.toHaveBeenCalled();
  });

  it("activates Standard Agent on enter when no row navigation has happened", () => {
    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const search = screen.getByLabelText("Search agents");
    fireEvent.keyDown(search, { key: "Enter" });

    expect(mockHandleSelectStandard).toHaveBeenCalledTimes(1);
    expect(mockHandleSelect).not.toHaveBeenCalled();
  });

  it("invokes handleSelectStandard when the Standard row is clicked", () => {
    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const standardRow = screen.getByRole("option", { name: /Standard Agent/i });
    fireEvent.mouseDown(standardRow);

    expect(mockHandleSelectStandard).toHaveBeenCalledTimes(1);
  });

  it("disables every row while a row is creating", () => {
    setDataMock({ creating: "remote-agent" });

    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    for (const option of screen.getAllByRole("option")) {
      expect(option).toBeDisabled();
    }
  });

  it("renders the Standard Agent row immediately while agents are still loading", () => {
    setDataMock({ agents: [], loading: true });

    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const standardRow = screen.getByRole("option", { name: /Standard Agent/i });
    expect(standardRow).toBeInTheDocument();
    expect(standardRow).not.toBeDisabled();

    fireEvent.mouseDown(standardRow);
    expect(mockHandleSelectStandard).toHaveBeenCalledTimes(1);
  });

  it("ignores a rapid second click on the Standard row before the creating state lands", () => {
    render(
      <AgentSelectorModal
        isOpen
        projectId="project-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const standardRow = screen.getByRole("option", { name: /Standard Agent/i });
    // Two synchronous mousedowns model a fast double-click that lands
    // before React has flushed the `setCreating(...)` from the first
    // activation. The synchronous activatingRef guard inside the list
    // must short-circuit the second one.
    fireEvent.mouseDown(standardRow);
    fireEvent.mouseDown(standardRow);

    expect(mockHandleSelectStandard).toHaveBeenCalledTimes(1);
  });
});
