import type { ButtonHTMLAttributes } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockNavigate = vi.fn();
const mockSetSidebarAction = vi.fn();
const mockRegisterAgents = vi.fn();
const mockRegisterRemoteAgents = vi.fn();
const mockRefreshProjectAgents = vi.fn();
const mockSetAgentsByProject = vi.fn();
const mockClosePreview = vi.fn();
const mockSaveProjectOrder = vi.fn();

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
  name: "Task board agent",
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
    streamingAgentInstanceIds: string[];
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

vi.mock("../../../../stores/app-ui-store", () => ({
  useAppUIStore: (selector: (state: { setSidebarAction: typeof mockSetSidebarAction }) => unknown) =>
    selector({ setSidebarAction: mockSetSidebarAction }),
}));

vi.mock("../../../../stores/profile-status-store", () => ({
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

vi.mock("../../../../components/ProjectList/useProjectListData", () => ({
  useProjectListData: () => mockProjectListData,
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (
    selector: (state: { saveProjectOrder: typeof mockSaveProjectOrder }) => unknown,
  ) => selector({ saveProjectOrder: mockSaveProjectOrder }),
}));

vi.mock("../../../../components/ProjectList/useExplorerMenus", () => ({
  useExplorerMenus: () => ({
    handleContextMenu: vi.fn(),
    handleKeyDown: vi.fn(),
  }),
}));

vi.mock("../../../../components/ProjectList/ExplorerContextMenu", () => ({
  ExplorerContextMenu: () => null,
}));

vi.mock("../../../../components/ProjectList/ProjectListModals", () => ({
  ProjectListModals: () => null,
}));

vi.mock("../../../../components/ProjectsPlusButton", () => ({
  ProjectsPlusButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>+</button>
  ),
}));

vi.mock("../../../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("@cypher-asi/zui", () => ({
  PageEmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="page-empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}));

import { TasksProjectList } from "./TasksProjectList";

function buildMockData(overrides: Partial<MockProjectListData> = {}): MockProjectListData {
  const agentsByProject = overrides.agentsByProject ?? { p1: [agent] };
  const projects = overrides.projects ?? [project];
  return {
    projectId: "p1",
    agentInstanceId: "a1",
    location: { pathname: "/tasks/p1/agents/a1" },
    sidekick: {
      closePreview: mockClosePreview,
      streamingAgentInstanceId: null,
      streamingAgentInstanceIds: [],
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
  mockProjectListData = buildMockData();
});

describe("TasksProjectList", () => {
  it("navigates to the project board when clicking a project row from an agent route", async () => {
    render(<TasksProjectList />);

    const projectRow = screen.getByTestId("project-p1");
    await screen.findByTestId("node-a1");

    fireEvent.click(projectRow);

    await waitFor(() => {
      expect(screen.queryByTestId("node-a1")).not.toBeInTheDocument();
    });
    expect(mockClosePreview).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/tasks/p1");
  });

  it("still toggles project expansion when the project board is already selected", async () => {
    mockProjectListData = buildMockData({
      agentInstanceId: null,
      location: { pathname: "/tasks/p1" },
    });

    render(<TasksProjectList />);

    const projectRow = screen.getByTestId("project-p1");
    await screen.findByTestId("node-a1");
    mockNavigate.mockClear();
    mockClosePreview.mockClear();

    fireEvent.click(projectRow);

    await waitFor(() => {
      expect(screen.queryByTestId("node-a1")).not.toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockClosePreview).not.toHaveBeenCalled();

    fireEvent.click(projectRow);

    expect(await screen.findByTestId("node-a1")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("reorders projects by drag and drop via the shared LeftMenu hook", async () => {
    mockProjectListData = buildMockData({
      projects: [
        { project_id: "p1", name: "Project 1" },
        { project_id: "p2", name: "Project 2" },
      ],
      agentsByProject: { p1: [agent], p2: [] },
    });

    render(<TasksProjectList />);

    const projectOne = await screen.findByTestId("project-p1");
    const projectTwo = await screen.findByTestId("project-p2");
    const rectMap = new Map<Element, DOMRect>([
      [projectOne, new DOMRect(0, 0, 200, 28)],
      [projectTwo, new DOMRect(0, 40, 200, 28)],
    ]);
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function () {
        return rectMap.get(this) ?? new DOMRect(0, 0, 200, 28);
      });

    fireEvent.pointerDown(projectOne, { button: 0, clientY: 12, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 64, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 64, pointerId: 1 });

    expect(mockSaveProjectOrder).toHaveBeenCalledWith(["p2", "p1"]);

    getBoundingClientRectSpy.mockRestore();
  });
});
