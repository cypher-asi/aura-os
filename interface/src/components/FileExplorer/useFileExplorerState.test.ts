import { renderHook, waitFor } from "@testing-library/react";

const mockListHostedFiles = vi.fn();
const mockListLocalDirectory = vi.fn();
const mockListRemoteDirectory = vi.fn();
const mockAuthState = vi.hoisted(() => ({ userId: "user-1" }));

vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { user_id: string } }) => unknown) =>
    selector({ user: { user_id: mockAuthState.userId } }),
}));

vi.mock("../../api/client", () => ({
  ApiClientError: class extends Error {
    constructor(public status: number, body: { error: string }) {
      super(body.error);
    }
  },
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

import { ApiClientError } from "../../api/client";
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
      useFileExplorerState({ hostedWorkspace: target, remoteAgentId: "another-remote-agent", rootLabel: "Project files" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockListHostedFiles).toHaveBeenCalledWith(target);
    expect(mockListLocalDirectory).not.toHaveBeenCalled();
    expect(mockListRemoteDirectory).not.toHaveBeenCalled();
    expect(result.current.isHosted).toBe(true);
    expect(result.current.isRemote).toBe(false);
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

describe("useFileExplorerState remote workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.userId = "user-1";
  });

  it("does not reuse one remote agent's listing for another agent at the same path", async () => {
    let finishSecond: ((value: unknown) => void) | undefined;
    mockListRemoteDirectory.mockImplementation((agentId: string) => (
      agentId === "agent-1"
        ? Promise.resolve({ ok: true, entries: [{ name: "private-a.ts", path: "/workspace/private-a.ts", is_dir: false }] })
        : new Promise((resolve) => { finishSecond = resolve; })
    ));
    const { result, rerender, unmount } = renderHook(
      ({ agentId }) => useFileExplorerState({ rootPath: "/workspace", remoteAgentId: agentId }),
      { initialProps: { agentId: "agent-1" } },
    );
    await waitFor(() => expect(result.current.entries[0]?.name).toBe("private-a.ts"));

    rerender({ agentId: "agent-2" });
    expect(result.current.loading).toBe(true);
    expect(result.current.entries).toEqual([]);
    expect(result.current.filteredData[0]?.children).toEqual([]);

    await waitFor(() => expect(mockListRemoteDirectory).toHaveBeenCalledWith("agent-2", "/workspace"));
    finishSecond?.({ ok: true, entries: [{ name: "private-b.ts", path: "/workspace/private-b.ts", is_dir: false }] });
    await waitFor(() => expect(result.current.entries[0]?.name).toBe("private-b.ts"));
    expect(result.current.entries.some((entry) => entry.name === "private-a.ts")).toBe(false);
    unmount();
  });

  it("hides the previous account's listing immediately when auth ownership changes", async () => {
    let finishSecond: ((value: unknown) => void) | undefined;
    mockListRemoteDirectory
      .mockResolvedValueOnce({ ok: true, entries: [{ name: "user-one.ts", path: "/workspace/user-one.ts", is_dir: false }] })
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
    const { result, rerender, unmount } = renderHook(() =>
      useFileExplorerState({ rootPath: "/workspace", remoteAgentId: "agent-1" }),
    );
    await waitFor(() => expect(result.current.entries[0]?.name).toBe("user-one.ts"));

    mockAuthState.userId = "user-2";
    rerender();
    expect(result.current.loading).toBe(true);
    expect(result.current.entries).toEqual([]);

    await waitFor(() => expect(mockListRemoteDirectory).toHaveBeenCalledTimes(2));
    finishSecond?.({ ok: true, entries: [{ name: "user-two.ts", path: "/workspace/user-two.ts", is_dir: false }] });
    await waitFor(() => expect(result.current.entries[0]?.name).toBe("user-two.ts"));
    unmount();
  });

  it("retains only a same-agent list after a transient outage, but clears it on revoked access", async () => {
    mockListRemoteDirectory.mockResolvedValueOnce({
      ok: true,
      entries: [{ name: "last-known.ts", path: "/workspace/last-known.ts", is_dir: false }],
    });
    const { result, rerender, unmount } = renderHook(
      ({ refreshTrigger }) => useFileExplorerState({ rootPath: "/workspace", remoteAgentId: "agent-1", refreshTrigger }),
      { initialProps: { refreshTrigger: 0 } },
    );
    await waitFor(() => expect(result.current.entries[0]?.name).toBe("last-known.ts"));

    mockListRemoteDirectory.mockRejectedValueOnce(new ApiClientError(503, { error: "pod unavailable", code: "offline", details: null }));
    rerender({ refreshTrigger: 1 });
    await waitFor(() => expect(result.current.error).toBe("pod unavailable"));
    expect(result.current.entries[0]?.name).toBe("last-known.ts");

    mockListRemoteDirectory.mockRejectedValueOnce(new ApiClientError(403, { error: "access denied", code: "forbidden", details: null }));
    rerender({ refreshTrigger: 2 });
    await waitFor(() => expect(result.current.error).toBe("access denied"));
    expect(result.current.entries).toEqual([]);
    unmount();
  });
});
