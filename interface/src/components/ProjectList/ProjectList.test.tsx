import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Project, ProjectId } from "../../types";
import { useEffect } from "react";

let autoSelectDefaultIds = false;
const mockNavigate = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  ButtonPlus: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>+</button>
  ),
  Explorer: ({
    data,
    defaultSelectedIds,
    onSelect,
  }: {
    data: { id: string; label: string; children?: { id: string; label: string }[] }[];
    defaultSelectedIds?: Iterable<string>;
    onSelect?: (ids: Iterable<string>) => void;
  }) => {
    useEffect(() => {
      if (!autoSelectDefaultIds || !defaultSelectedIds || !onSelect) return;
      onSelect(defaultSelectedIds);
    }, [defaultSelectedIds, onSelect]);

    return (
      <div data-testid="explorer">
        {data.map((node) => (
          <div key={node.id}>
            <span>{node.label}</span>
            {node.children?.map((child) => (
              <span key={child.id}>{child.label}</span>
            ))}
          </div>
        ))}
      </div>
    );
  },
  Menu: () => <div data-testid="menu" />,
  PageEmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="page-empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}));

const mockSidekickState = {
  closePreview: vi.fn(),
  streamingAgentInstanceId: null,
  onAgentInstanceUpdate: vi.fn(() => vi.fn()),
};
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockActions = {
  ctxMenu: null as unknown,
  ctxMenuRef: { current: null },
  renameTarget: null,
  settingsTarget: null,
  deleteTarget: null,
  deleteLoading: false,
  deleteAgentTarget: null,
  deleteAgentLoading: false,
  deleteAgentError: null,
  agentSelectorProjectId: null,
  setRenameTarget: vi.fn(),
  setSettingsTarget: vi.fn(),
  setDeleteTarget: vi.fn(),
  setDeleteAgentTarget: vi.fn(),
  setDeleteAgentError: vi.fn(),
  setAgentSelectorProjectId: vi.fn(),
  setCtxMenu: vi.fn(),
  handleMenuAction: vi.fn(),
  handleRename: vi.fn(),
  handleDelete: vi.fn(),
  handleDeleteAgent: vi.fn(),
  handleAgentCreated: vi.fn(),
  handleProjectSaved: vi.fn(),
  handleAddAgent: vi.fn(),
};
vi.mock("../../hooks/use-project-list-actions", () => ({
  useProjectListActions: () => mockActions,
}));

const mockProjectsList = {
  projects: [] as Project[],
  loadingProjects: false,
  agentsByProject: {} as Record<string, { agent_instance_id: string; name: string }[]>,
  setAgentsByProject: vi.fn(),
  refreshProjectAgents: vi.fn(),
  openNewProjectModal: vi.fn(),
};
vi.mock("../../apps/projects/useProjectsList", () => ({
  useProjectsList: () => mockProjectsList,
}));

vi.mock("../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({
    query: "",
    setAction: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-loop-status", () => ({
  useLoopStatus: () => ({
    automatingProjectId: null,
    automatingAgentInstanceId: null,
  }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    isMobileLayout: false,
  }),
}));

vi.mock("../../utils/mobileNavigation", () => ({
  getMobileProjectDestination: () => null,
  projectRootPath: (id: string) => `/projects/${id}`,
  projectAgentRoute: (id: string) => `/projects/${id}/agent`,
  projectFilesRoute: (id: string) => `/projects/${id}/files`,
  projectStatsRoute: (id: string) => `/projects/${id}/stats`,
  projectWorkRoute: (id: string) => `/projects/${id}/work`,
}));

vi.mock("../InlineRenameInput", () => ({
  InlineRenameInput: () => <div data-testid="rename-input" />,
}));
vi.mock("../DeleteProjectModal", () => ({
  DeleteProjectModal: () => null,
}));
vi.mock("../DeleteAgentInstanceModal", () => ({
  DeleteAgentInstanceModal: () => null,
}));
vi.mock("../ProjectSettingsModal", () => ({
  ProjectSettingsModal: () => null,
}));
vi.mock("../AgentSelectorModal", () => ({
  AgentSelectorModal: () => null,
}));

vi.mock("./ProjectList.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { ProjectList } from "../ProjectList";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    project_id: "p1" as ProjectId,
    org_id: "org-1",
    name: "My Project",
    description: "",
    current_status: "active",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  } as Project;
}

function renderList(path = "/projects") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  autoSelectDefaultIds = false;
  mockProjectsList.projects = [];
  mockProjectsList.loadingProjects = false;
  mockProjectsList.agentsByProject = {};
});

describe("ProjectList", () => {
  it("shows empty state when no projects exist", () => {
    mockProjectsList.projects = [];
    renderList();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("shows empty state description", () => {
    mockProjectsList.projects = [];
    renderList();
    expect(
      screen.getByText(/Open an existing project or create a linked one from the desktop app/),
    ).toBeInTheDocument();
  });

  it("renders project names in the explorer tree", () => {
    mockProjectsList.projects = [
      makeProject({ project_id: "p1" as ProjectId, name: "Alpha" }),
      makeProject({ project_id: "p2" as ProjectId, name: "Beta" }),
    ];
    mockProjectsList.agentsByProject = {
      p1: [{ agent_instance_id: "a1", name: "Agent 1" }],
      p2: [],
    };
    renderList();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders agent instances under projects", () => {
    mockProjectsList.projects = [makeProject()];
    mockProjectsList.agentsByProject = {
      p1: [
        { agent_instance_id: "a1", name: "Agent Alpha" },
        { agent_instance_id: "a2", name: "Agent Beta" },
      ],
    };
    renderList();
    expect(screen.getByText("Agent Alpha")).toBeInTheDocument();
    expect(screen.getByText("Agent Beta")).toBeInTheDocument();
  });

  it("shows loading placeholder when agents not yet loaded", () => {
    mockProjectsList.projects = [makeProject()];
    renderList();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders rename input when renameTarget is set", () => {
    mockProjectsList.projects = [makeProject()];
    mockProjectsList.agentsByProject = { p1: [] };
    mockActions.renameTarget = makeProject();
    renderList();
    expect(screen.getByTestId("rename-input")).toBeInTheDocument();
    mockActions.renameTarget = null;
  });

  it("does not render empty-name projects", () => {
    mockProjectsList.projects = [
      makeProject({ project_id: "p1" as ProjectId, name: "Visible" }),
      makeProject({ project_id: "p2" as ProjectId, name: "   " }),
    ];
    mockProjectsList.agentsByProject = { p1: [], p2: [] };
    renderList();
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText(/^\s+$/)).not.toBeInTheDocument();
  });

  it("does not reroute nested desktop stats paths back to agent chat on initial project selection", async () => {
    autoSelectDefaultIds = true;
    mockProjectsList.projects = [makeProject()];
    mockProjectsList.agentsByProject = {
      p1: [{ agent_instance_id: "a1", name: "Agent Alpha" }],
    };

    renderList("/projects/p1/stats");

    await waitFor(() => {
      expect(mockNavigate).not.toHaveBeenCalledWith("/projects/p1/agents/a1");
      expect(mockNavigate).not.toHaveBeenCalledWith("/projects/p1/agent");
    });
  });
});
