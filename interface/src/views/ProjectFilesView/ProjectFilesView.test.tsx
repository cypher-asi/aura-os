import { render, screen } from "../../test/render";

const mockUseProjectContext = vi.fn();
const mockUseTerminalTarget = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectContext(),
}));

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => mockUseTerminalTarget(),
}));

vi.mock("../../components/PanelSearch", () => ({
  PanelSearch: ({ placeholder }: { placeholder?: string }) => <div data-testid="panel-search">{placeholder}</div>,
}));

vi.mock("../../components/FileExplorer", () => ({
  FileExplorer: ({
    rootPath,
    searchQuery,
  }: {
    rootPath?: string;
    searchQuery?: string;
  }) => (
    <div data-testid="file-explorer" data-root-path={rootPath ?? ""} data-search-query={searchQuery ?? ""} />
  ),
}));

vi.mock("./ProjectFilesView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectFilesView } from "./ProjectFilesView";

const project = {
  project_id: "proj-1",
  name: "Demo Project",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectContext.mockReturnValue({ project });
  mockUseTerminalTarget.mockReturnValue({
    remoteAgentId: "remote-agent-1",
    remoteWorkspacePath: "p/demo-project",
    workspacePath: "p/demo-project",
    status: "ready",
  });
});

describe("ProjectFilesView", () => {
  it("keeps the desktop explorer behavior unchanged", () => {
    render(<ProjectFilesView />);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Remote agent workspace")).toBeInTheDocument();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
    expect(screen.queryByText(/Workspace files will appear here when this project has a live remote workspace/i)).not.toBeInTheDocument();
  });

  it("does not render while the desktop workspace target is loading", () => {
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "loading",
    });

    const { container } = render(<ProjectFilesView />);

    expect(container).toBeEmptyDOMElement();
  });
});
