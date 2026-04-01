import { render, screen } from "../../test/render";

const mockUseProjectContext = vi.fn();
const mockUseAuraCapabilities = vi.fn();
const mockUseProjectsListStore = vi.fn();
const mockUseTerminalTarget = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectContext: () => mockUseProjectContext(),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => mockUseTerminalTarget(),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: Array<Record<string, unknown>> }) => unknown) =>
    selector(mockUseProjectsListStore()),
}));

vi.mock("../../components/PanelSearch", () => ({
  PanelSearch: ({ placeholder }: { placeholder?: string }) => <div data-testid="panel-search">{placeholder}</div>,
}));

vi.mock("../../components/FileExplorer", () => ({
  FileExplorer: ({ rootPath, searchQuery }: { rootPath?: string; searchQuery?: string }) => (
    <div data-testid="file-explorer" data-root-path={rootPath ?? ""} data-search-query={searchQuery ?? ""} />
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ projectId: "proj-1" }),
  };
});

vi.mock("./ProjectFilesView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectFilesView } from "./ProjectFilesView";

const project = {
  project_id: "proj-1",
  name: "Demo Project",
  linked_folder_path: "p/demo-project",
  workspace_source: "remote",
  workspace_display_path: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectContext.mockReturnValue({ project });
  mockUseProjectsListStore.mockReturnValue({ projects: [project] });
  mockUseTerminalTarget.mockReturnValue({
    remoteAgentId: "remote-agent-1",
    remoteWorkspacePath: "p/demo-project",
    workspacePath: "p/demo-project",
    status: "ready",
  });
});

describe("ProjectFilesView", () => {
  it("shows a remote-workspace placeholder on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    render(<ProjectFilesView />);

    expect(screen.getByText("Files stay on the remote agent")).toBeInTheDocument();
    expect(screen.getByText("Project path: p/demo-project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Agent" })).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("keeps the file explorer on desktop", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    render(<ProjectFilesView />);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
    expect(screen.queryByText("Files stay on the remote agent")).not.toBeInTheDocument();
  });
});
