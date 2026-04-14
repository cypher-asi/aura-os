import type { ButtonHTMLAttributes } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockNavigate = vi.fn();
const mockSetSidebarAction = vi.fn();
const mockRegisterAgents = vi.fn();
const mockRegisterRemoteAgents = vi.fn();
const mockRefreshProjectAgents = vi.fn();
const mockSetAgentsByProject = vi.fn();
const mockClosePreview = vi.fn();

type MockProject = { project_id: string; name: string };
type MockAgent = {
  agent_id: string;
  agent_instance_id: string;
  project_id: string;
  name: string;
  status: string;
  machine_type: string;
  icon?: string | null;
  updated_at?: string;
};

const project: MockProject = { project_id: "p1", name: "cypher-asi/aura-os" };
const agent: MockAgent = {
  agent_id: "agent-1",
  agent_instance_id: "a1",
  project_id: "p1",
  name: "Navigation rail and taskbar icons",
  status: "idle",
  machine_type: "local",
  updated_at: "2026-04-12T00:00:00Z",
};

const mockActions = {
  handleAddAgent: vi.fn(),
  handleQuickAddAgent: vi.fn(),
  handleArchiveAgent: vi.fn(),
  creatingGeneralAgentProjectIds: [],
  archivingAgentInstanceIds: [],
};

interface MockProjectListData {
  projectId: string | null;
  agentInstanceId: string | null;
  location: { pathname: string };
  sidekick: {
    closePreview: typeof mockClosePreview;
    streamingAgentInstanceId: string | null;
    onAgentInstanceUpdate: (callback: (instance: MockAgent) => void) => () => void;
  };
  projects: MockProject[];
  loadingProjects: boolean;
  agentsByProject: Record<string, MockAgent[]>;
  setAgentsByProject: typeof mockSetAgentsByProject;
  refreshProjectAgents: typeof mockRefreshProjectAgents;
  openNewProjectModal: ReturnType<typeof vi.fn>;
  searchQuery: string;
  isMobileLayout: boolean;
  automatingProjectId: string | null;
  automatingAgentInstanceId: string | null;
  actions: typeof mockActions;
  projectMap: Map<string, MockProject>;
  agentMeta: Map<string, { projectId: string; agent: MockAgent }>;
}

let mockProjectListData: MockProjectListData;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@cypher-asi/zui", () => ({
  ButtonPlus: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>+</button>
  ),
  PageEmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="page-empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock("../../stores/app-ui-store", () => ({
  useAppUIStore: (selector: (state: { setSidebarAction: typeof mockSetSidebarAction }) => unknown) =>
    selector({ setSidebarAction: mockSetSidebarAction }),
}));

vi.mock("../../stores/profile-status-store", () => ({
  useProfileStatusStore: (
    selector: (state: {
      statuses: Record<string, string>;
      machineTypes: Record<string, string>;
      registerAgents: typeof mockRegisterAgents;
      registerRemoteAgents: typeof mockRegisterRemoteAgents;
    }) => unknown,
  ) =>
    selector({
      statuses: {},
      machineTypes: {},
      registerAgents: mockRegisterAgents,
      registerRemoteAgents: mockRegisterRemoteAgents,
    }),
}));

vi.mock("../ProjectList/useProjectListData", () => ({
  useProjectListData: () => mockProjectListData,
}));

vi.mock("../ProjectList/useExplorerMenus", () => ({
  useExplorerMenus: () => ({
    handleContextMenu: vi.fn(),
    handleKeyDown: vi.fn(),
  }),
}));

vi.mock("../ProjectList/ExplorerContextMenu", () => ({
  ExplorerContextMenu: () => null,
}));

vi.mock("../ProjectList/ProjectListModals", () => ({
  ProjectListModals: () => null,
}));

vi.mock("./ProjectsNav.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectsNav } from "./ProjectsNav";

function buildMockData(overrides: Partial<MockProjectListData> = {}): MockProjectListData {
  const agentsByProject = overrides.agentsByProject ?? { p1: [agent] };
  const projects = overrides.projects ?? [project];
  return {
    projectId: null,
    agentInstanceId: null,
    location: { pathname: "/projects" },
    sidekick: {
      closePreview: mockClosePreview,
      streamingAgentInstanceId: null,
      onAgentInstanceUpdate: vi.fn(() => vi.fn()),
    },
    projects,
    loadingProjects: false,
    agentsByProject,
    setAgentsByProject: mockSetAgentsByProject,
    refreshProjectAgents: mockRefreshProjectAgents,
    openNewProjectModal: vi.fn(),
    searchQuery: "",
    isMobileLayout: false,
    automatingProjectId: null,
    automatingAgentInstanceId: null,
    actions: mockActions,
    projectMap: new Map(projects.map((entry: MockProject) => [entry.project_id, entry])),
    agentMeta: new Map(
      Object.entries(agentsByProject).flatMap(([pid, agents]) =>
        agents.map((entry: MockAgent) => [
          entry.agent_instance_id,
          { projectId: pid, agent: entry },
        ]),
      ),
    ),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockProjectListData = buildMockData();
});

describe("ProjectsNav", () => {
  it("renders project headers and nested agents without relying on Explorer", async () => {
    render(<ProjectsNav />);

    expect(screen.getByTestId("project-p1")).toHaveTextContent("cypher-asi/aura-os");
    expect(await screen.findByTestId("node-a1")).toHaveTextContent(
      "Navigation rail and taskbar icons",
    );
  });

  it("renders a global Archived group collapsed by default", async () => {
    mockProjectListData = buildMockData({
      agentsByProject: {
        p1: [
          agent,
          {
            ...agent,
            agent_instance_id: "a2",
            name: "Archived refactor thread",
            status: "archived",
          },
        ],
      },
    });

    render(<ProjectsNav />);

    const archivedGroup = await screen.findByTestId("project-_archived");
    expect(archivedGroup).toHaveTextContent("Archived");
    expect(archivedGroup).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("node-a2")).not.toBeInTheDocument();

    fireEvent.click(archivedGroup);

    expect(await screen.findByTestId("node-a2")).toHaveTextContent("Archived refactor thread");
  });

  it("keeps project rows non-selectable and toggles them without remounting the row", async () => {
    mockProjectListData = buildMockData({
      projectId: "p1",
      agentInstanceId: "a1",
      location: { pathname: "/projects/p1/agents/a1" },
    });

    render(<ProjectsNav />);

    const projectRow = screen.getByTestId("project-p1");
    await screen.findByTestId("node-a1");
    mockNavigate.mockClear();

    fireEvent.click(projectRow);

    await waitFor(() => {
      expect(screen.queryByTestId("node-a1")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("project-p1")).toBe(projectRow);
    expect(projectRow).toHaveAttribute("aria-selected", "false");
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(projectRow);

    const agentRow = await screen.findByTestId("node-a1");
    expect(screen.getByTestId("project-p1")).toBe(projectRow);
    expect(agentRow).toHaveAttribute("aria-selected", "true");
    expect(agentRow.className).toContain("agentRowSelected");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows an informational empty state for opened projects without agents", async () => {
    mockProjectListData = buildMockData({
      agentsByProject: { p1: [] },
    });

    render(<ProjectsNav />);

    const emptyState = await screen.findByTestId("empty-p1");
    expect(emptyState).toHaveTextContent("No agents yet");
    expect(screen.queryByTestId("node-_empty_p1")).not.toBeInTheDocument();

    mockNavigate.mockClear();
    fireEvent.click(emptyState);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("preserves agent row navigation", async () => {
    render(<ProjectsNav />);

    const agentRow = await screen.findByTestId("node-a1");
    mockNavigate.mockClear();

    fireEvent.click(agentRow);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/agents/a1");
    });
  });

  it("keeps execution rows selectable when mobile execution entries are present", async () => {
    mockProjectListData = buildMockData({
      isMobileLayout: true,
      location: { pathname: "/projects" },
    });

    render(<ProjectsNav />);

    const executionRow = await screen.findByTestId("node-execution:p1");
    mockNavigate.mockClear();

    fireEvent.click(executionRow);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/work");
    });
  });

  it("keeps large project trees visible while virtualization initializes", async () => {
    const projects = Array.from({ length: 32 }, (_, index) => ({
      project_id: `p${index}`,
      name: `Project ${index}`,
    }));
    const agentsByProject = Object.fromEntries(
      projects.map((entry, index) => [
        entry.project_id,
        [
          {
            ...agent,
            project_id: entry.project_id,
            agent_instance_id: `a${index}`,
            name: `Agent ${index}`,
          },
        ],
      ]),
    );

    mockProjectListData = buildMockData({
      projects,
      agentsByProject,
    });

    render(<ProjectsNav />);

    expect(await screen.findByTestId("project-p0")).toHaveTextContent("Project 0");
  });
});
