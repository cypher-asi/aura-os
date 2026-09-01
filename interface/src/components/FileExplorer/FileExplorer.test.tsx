import { fireEvent, render, screen } from "../../test/render";

const mockUseFileExplorerState = vi.fn();

vi.mock("../ListTree", () => ({
  ListTree: ({ expandedIds }: { expandedIds?: string[] }) => (
    <div data-testid="list-tree" data-expanded-ids={(expandedIds ?? []).join(",")} />
  ),
}));

vi.mock("@cypher-asi/zui", () => ({
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
  FILE_EXPLORER_ROOT_ID: "__files_root__",
  useFileExplorerState: (...args: unknown[]) => mockUseFileExplorerState(...args),
}));

vi.mock("../../mobile/files/MobileFileList", () => ({
  MobileFileList: ({ expandedIds }: { expandedIds: ReadonlySet<string> }) => (
    <div data-testid="mobile-file-list" data-expanded-ids={[...expandedIds].join(",")} />
  ),
}));

vi.mock("./FileExplorerHeader", () => ({
  FileExplorerHeader: ({
    onExpandAll,
    onCollapseAll,
    canExpandAll,
    canCollapseAll,
  }: {
    onExpandAll?: () => void;
    onCollapseAll?: () => void;
    canExpandAll?: boolean;
    canCollapseAll?: boolean;
  }) => (
    <div data-testid="file-explorer-header">
      <button type="button" onClick={onExpandAll} disabled={!canExpandAll}>Expand all folders</button>
      <button type="button" onClick={onCollapseAll} disabled={!canCollapseAll}>Collapse all folders</button>
    </div>
  ),
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
    isHosted: false,
    loading: false,
    entries: [],
    error: null,
    features: {},
    isMobileLayout: true,
    filteredData: [],
    folderIds: ["__files_root__"],
    filteredFolderIds: ["__files_root__"],
    defaultExpandedIds: ["__files_root__"],
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

  it("starts collapsed and expands or collapses every folder from the header", () => {
    setExplorerState({
      isMobileLayout: false,
      entries: [{ name: "src", path: "/workspace/src", is_dir: true, children: [] }],
      filteredData: [
        {
          id: "__files_root__",
          label: "workspace",
          children: [
            {
              id: "/workspace/src",
              label: "src",
              children: [
                { id: "/workspace/src/nested", label: "nested", children: [] },
              ],
            },
          ],
        },
      ],
      folderIds: ["__files_root__", "/workspace/src", "/workspace/src/nested"],
      filteredFolderIds: ["__files_root__", "/workspace/src", "/workspace/src/nested"],
    });

    render(<FileExplorer rootPath="/workspace" />);

    expect(screen.getByTestId("list-tree")).toHaveAttribute(
      "data-expanded-ids",
      "__files_root__",
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand all folders" }));
    expect(screen.getByTestId("list-tree")).toHaveAttribute(
      "data-expanded-ids",
      "__files_root__,/workspace/src,/workspace/src/nested",
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse all folders" }));
    expect(screen.getByTestId("list-tree")).toHaveAttribute(
      "data-expanded-ids",
      "__files_root__",
    );
  });

  it("reveals matching folder ancestors while search is active", () => {
    setExplorerState({
      isMobileLayout: false,
      entries: [{ name: "src", path: "/workspace/src", is_dir: true, children: [] }],
      filteredData: [
        {
          id: "__files_root__",
          label: "workspace",
          children: [
            {
              id: "/workspace/src",
              label: "src",
              children: [{ id: "/workspace/src/target.ts", label: "target.ts" }],
            },
          ],
        },
      ],
      folderIds: ["__files_root__", "/workspace/src"],
      filteredFolderIds: ["__files_root__", "/workspace/src"],
    });

    render(<FileExplorer rootPath="/workspace" searchQuery="target" />);

    expect(screen.getByTestId("list-tree")).toHaveAttribute(
      "data-expanded-ids",
      "__files_root__,/workspace/src",
    );
    expect(screen.getByRole("button", { name: "Expand all folders" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Collapse all folders" })).toBeDisabled();
  });
});
