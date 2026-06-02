import { render, screen, waitFor } from "../../../test/render";
import { Route, Routes, useLocation } from "react-router-dom";

const mockUseProjectsListStore = vi.fn();
const mockUseTerminalTarget = vi.fn();
const mockReadRemoteFile = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Spinner: () => <div>Loading...</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../api/client", () => ({
  api: {
    swarm: {
      readRemoteFile: (...args: unknown[]) => mockReadRemoteFile(...args),
    },
  },
}));

vi.mock("../../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => mockUseTerminalTarget(),
}));

vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: Array<Record<string, unknown>> }) => unknown) =>
    selector(mockUseProjectsListStore()),
}));

vi.mock("../../../components/PanelSearch", () => ({
  PanelSearch: ({ placeholder }: { placeholder?: string }) => <div data-testid="panel-search">{placeholder}</div>,
}));

vi.mock("../../../components/FileExplorer", () => ({
  FileExplorer: ({
    rootPath,
    searchQuery,
    onFileSelect,
  }: {
    rootPath?: string;
    searchQuery?: string;
    onFileSelect?: (path: string) => void;
  }) => (
    <div>
      <div data-testid="file-explorer" data-root-path={rootPath ?? ""} data-search-query={searchQuery ?? ""} />
      {onFileSelect ? (
        <button type="button" onClick={() => onFileSelect("/workspace/README.md")}>
          Preview README
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("./ProjectFilesScreen.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { MobileProjectFilesScreen } from "./ProjectFilesScreen";

const project = {
  project_id: "proj-1",
  name: "Demo Project",
};

function SearchProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderMobileFiles(initialEntry = "/projects/proj-1/files") {
  return render(
    <Routes>
      <Route path="/projects/:projectId/files" element={<><MobileProjectFilesScreen /><SearchProbe /></>} />
    </Routes>,
    { routerProps: { initialEntries: [initialEntry] } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectsListStore.mockReturnValue({ projects: [project] });
  mockUseTerminalTarget.mockReturnValue({
    remoteAgentId: "remote-agent-1",
    remoteWorkspacePath: "p/demo-project",
    workspacePath: "p/demo-project",
    status: "ready",
  });
  mockReadRemoteFile.mockResolvedValue({ ok: true, content: "# Hello remote" });
});

describe("MobileProjectFilesScreen", () => {
  it("keeps the mobile files route on-page and shows the remote explorer", () => {
    renderMobileFiles();

    expect(screen.getByText("Remote workspace")).toBeInTheDocument();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
  });

  it("records the selected mobile file in search params for preview", async () => {
    renderMobileFiles();

    screen.getByRole("button", { name: "Preview README" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("?file=%2Fworkspace%2FREADME.md");
    });
  });

  it("loads a mobile remote-file preview without sending users into the IDE", async () => {
    renderMobileFiles("/projects/proj-1/files?file=%2Fworkspace%2FREADME.md");

    await waitFor(() => {
      expect(mockReadRemoteFile).toHaveBeenCalledWith("remote-agent-1", "/workspace/README.md");
      expect(screen.getByText("# Hello remote")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Back to files" })).toBeInTheDocument();
  });

  it("shows a workspace empty state on mobile when no remote workspace is available", () => {
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    });

    renderMobileFiles();

    expect(screen.getByText(/Workspace files will appear here when this project has a live remote workspace/i)).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("shows a loading state while the remote workspace target is still resolving on mobile", () => {
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "loading",
    });

    renderMobileFiles();

    expect(screen.getByText(/Remote workspace is still loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("shows an error state instead of a no-workspace state when remote target resolution fails", () => {
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "error",
    });

    renderMobileFiles();

    expect(screen.getByText(/Remote workspace data could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/Workspace files will appear here when this project has a live remote workspace/i)).not.toBeInTheDocument();
  });
});
