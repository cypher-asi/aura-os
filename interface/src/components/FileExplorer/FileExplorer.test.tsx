import { render, screen } from "../../test/render";

const mockUseFileExplorerState = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Explorer: () => <div data-testid="explorer" />,
  Spinner: () => <div>Loading...</div>,
  PageEmptyState: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => (
    <section>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  ),
}));

vi.mock("./useFileExplorerState", () => ({
  useFileExplorerState: (...args: unknown[]) => mockUseFileExplorerState(...args),
}));

vi.mock("./MobileFileList", () => ({
  MobileFileList: () => <div data-testid="mobile-file-list" />,
}));

vi.mock("./FileExplorerHeader", () => ({
  FileExplorerHeader: () => <div data-testid="file-explorer-header" />,
}));

vi.mock("./FileExplorer.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { FileExplorer } from "./FileExplorer";

function setExplorerState(overrides: Partial<ReturnType<typeof baseExplorerState>>) {
  mockUseFileExplorerState.mockReturnValue({
    ...baseExplorerState(),
    ...overrides,
  });
}

function baseExplorerState() {
  return {
    canBrowseWorkspace: true,
    isRemote: true,
    loading: false,
    entries: [],
    error: null,
    features: {},
    isMobileLayout: true,
    filteredData: [],
    defaultExpandedIds: [],
    handleSelect: vi.fn(),
    rootPath: "p/demo",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileExplorer", () => {
  it("does not expose raw remote gateway errors to users", () => {
    setExplorerState({
      isRemote: true,
      error: "Swarm gateway returned 503",
    });

    render(<FileExplorer rootPath="p/demo" remoteAgentId="agent-1" />);

    expect(screen.getByText("Files are temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText("Remote files are temporarily unavailable. Try again in a moment.")).toBeInTheDocument();
    expect(screen.queryByText(/Swarm gateway returned 503/i)).not.toBeInTheDocument();
  });

  it("keeps local file errors descriptive for desktop workspace issues", () => {
    setExplorerState({
      isRemote: false,
      error: "Permission denied",
    });

    render(<FileExplorer rootPath="/workspace" />);

    expect(screen.getByText("Permission denied")).toBeInTheDocument();
  });
});
