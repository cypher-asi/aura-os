import { renderHook, waitFor } from "@testing-library/react";

const mockListHostedFiles = vi.fn();
const mockListLocalDirectory = vi.fn();
const mockListRemoteDirectory = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    hostedWorkspace: {
      listFiles: (...args: unknown[]) => mockListHostedFiles(...args),
    },
    listDirectory: (...args: unknown[]) => mockListLocalDirectory(...args),
    swarm: {
      listRemoteDirectory: (...args: unknown[]) => mockListRemoteDirectory(...args),
    },
    openIde: vi.fn(),
    openPath: vi.fn(),
  },
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: { linkedWorkspace: false },
    isMobileLayout: false,
  }),
}));

vi.mock("../../stores/event-store/index", () => ({
  useEventStore: {
    getState: () => ({ subscribe: () => () => undefined }),
  },
}));

import { useFileExplorerState } from "./useFileExplorerState";

describe("useFileExplorerState hosted workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListHostedFiles.mockResolvedValue({
      ok: true,
      entries: [
        { name: "index.html", path: "index.html", is_dir: false },
        {
          name: "src",
          path: "src",
          is_dir: true,
          children: [{ name: "app.ts", path: "src/app.ts", is_dir: false }],
        },
      ],
    });
  });

  it("uses the hosted project-scoped API without inventing a server path", async () => {
    const target = { projectId: "project-1", agentInstanceId: "instance-1" };
    const { result, unmount } = renderHook(() =>
      useFileExplorerState({ hostedWorkspace: target, rootLabel: "Project files" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockListHostedFiles).toHaveBeenCalledWith(target);
    expect(mockListLocalDirectory).not.toHaveBeenCalled();
    expect(mockListRemoteDirectory).not.toHaveBeenCalled();
    expect(result.current.entries.map((entry) => entry.name)).toEqual([
      "index.html",
      "src",
    ]);
    expect(result.current.filteredData[0]?.label).toBe("Project files");
    expect(result.current.defaultExpandedIds).toEqual(["__files_root__"]);
    expect(result.current.folderIds).toEqual(["__files_root__", "src"]);
    unmount();
  });
});
