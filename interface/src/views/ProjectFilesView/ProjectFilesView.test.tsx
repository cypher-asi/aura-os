import * as React from "react";
import { render, screen, waitFor } from "../../test/render";

const mockUseProjectContext = vi.fn();
const mockUseAuraCapabilities = vi.fn();
const mockUseProjectsListStore = vi.fn();
const mockUseTerminalTarget = vi.fn();
const mockReadRemoteFile = vi.fn();
const mockSetSearchParams = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Spinner: () => <div>Loading…</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../api/client", () => ({
  api: {
    swarm: {
      readRemoteFile: (...args: unknown[]) => mockReadRemoteFile(...args),
    },
  },
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectContext(),
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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ projectId: "proj-1" }),
    useSearchParams: () => [
      currentSearchParams,
      (next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) => {
        currentSearchParams = typeof next === "function" ? next(currentSearchParams) : next;
        mockSetSearchParams(currentSearchParams);
      },
    ],
  };
});

vi.mock("./ProjectFilesView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectFilesView } from "./ProjectFilesView";
import { MobileProjectFilesScreen } from "../../mobile/screens/ProjectFilesScreen/ProjectFilesScreen";

const project = {
  project_id: "proj-1",
  name: "Demo Project",
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSearchParams = new URLSearchParams();
  mockUseProjectContext.mockReturnValue({ project });
  mockUseProjectsListStore.mockReturnValue({ projects: [project] });
  mockUseTerminalTarget.mockReturnValue({
    remoteAgentId: "remote-agent-1",
    remoteWorkspacePath: "p/demo-project",
    workspacePath: "p/demo-project",
    status: "ready",
  });
  mockReadRemoteFile.mockResolvedValue({ ok: true, content: "# Hello remote" });
});

describe("ProjectFilesView", () => {
  it("keeps the mobile files route on-page and shows the remote explorer", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: true });

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText("Remote workspace")).toBeInTheDocument();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
  });

  it("records the selected mobile file in search params for preview", async () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: true });

    render(<MobileProjectFilesScreen />);

    screen.getByRole("button", { name: "Preview README" }).click();

    expect(mockSetSearchParams).toHaveBeenCalled();
    expect(currentSearchParams.get("file")).toBe("/workspace/README.md");
  });

  it("loads a mobile remote-file preview without sending users into the IDE", async () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: true });
    currentSearchParams = new URLSearchParams("file=%2Fworkspace%2FREADME.md");

    render(<MobileProjectFilesScreen />);

    await waitFor(() => {
      expect(mockReadRemoteFile).toHaveBeenCalledWith("remote-agent-1", "/workspace/README.md");
      expect(screen.getByText("# Hello remote")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Back to files" })).toBeInTheDocument();
  });

  it("shows a workspace empty state on mobile when no remote workspace is available", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: true });
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    });

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText(/Workspace files will appear here when this project has a live remote workspace/i)).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("shows a loading state while the remote workspace target is still resolving on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: true });
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "loading",
    });

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText(/Remote workspace is still loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("shows an error state instead of a no-workspace state when remote target resolution fails", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: true });
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "error",
    });

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText(/Remote workspace data could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/Workspace files will appear here when this project has a live remote workspace/i)).not.toBeInTheDocument();
  });

  it("keeps the desktop explorer even in a narrow responsive layout when the client is not mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: false });

    render(<ProjectFilesView />);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
    expect(screen.queryByText(/Remote workspace is still loading/i)).not.toBeInTheDocument();
  });

  it("keeps the desktop explorer behavior unchanged", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false, isMobileClient: false });

    render(<ProjectFilesView />);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
    expect(screen.queryByText(/Workspace files will appear here when this project has a live remote workspace/i)).not.toBeInTheDocument();
  });
});
