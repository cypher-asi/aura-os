import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiClientError } from "../../shared/api/core";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockReadRemoteFile = vi.fn();
const mockWriteRemoteFile = vi.fn();
const mockReadHostedFile = vi.fn();
const mockWriteHostedFile = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    swarm: {
      readRemoteFile: (...args: unknown[]) => mockReadRemoteFile(...args),
      writeRemoteFile: (...args: unknown[]) => mockWriteRemoteFile(...args),
    },
    hostedWorkspace: {
      readFile: (...args: unknown[]) => mockReadHostedFile(...args),
      writeFile: (...args: unknown[]) => mockWriteHostedFile(...args),
    },
  },
}));

import { useIdeViewTabs } from "./useIdeViewTabs";

describe("useIdeViewTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue({ ok: true, content: "local content" });
    mockWriteFile.mockResolvedValue({ ok: true });
    mockReadRemoteFile.mockResolvedValue({
      ok: true,
      content: "remote content",
      revision: "remote-revision",
    });
    mockWriteRemoteFile.mockResolvedValue({ ok: true, revision: "remote-next" });
    mockReadHostedFile.mockResolvedValue({
      ok: true,
      content: "hosted content",
      revision: "hosted-revision",
    });
    mockWriteHostedFile.mockResolvedValue({ ok: true, revision: "hosted-next" });
  });

  it("saves local editor changes through the local file API", async () => {
    const { result } = renderHook(() => useIdeViewTabs("/Users/demo/app.ts"));

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("local content");
    });

    act(() => {
      result.current.handleContentChange("local changed");
    });
    await waitFor(() => {
      expect(result.current.dirty).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/Users/demo/app.ts",
      "local changed",
    );
  });

  it("saves remote IDE changes through the revision-checked workspace API", async () => {
    const { result } = renderHook(() =>
      useIdeViewTabs("/workspace/app.ts", "remote-agent-1"),
    );

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("remote content");
    });

    expect(result.current.readOnly).toBe(false);

    act(() => {
      result.current.handleContentChange("remote changed");
    });

    expect(result.current.activeTab?.content).toBe("remote changed");

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockWriteRemoteFile).toHaveBeenCalledWith(
      "remote-agent-1",
      "/workspace/app.ts",
      "remote changed",
      "remote-revision",
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);
  });

  it("reads and saves hosted files through the scoped API", async () => {
    const target = { projectId: "project-1", agentInstanceId: "instance-1" };
    const { result } = renderHook(() =>
      useIdeViewTabs("index.html", undefined, target),
    );

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("hosted content");
    });

    expect(mockReadHostedFile).toHaveBeenCalledWith(target, "index.html");
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(result.current.readOnly).toBe(false);

    act(() => {
      result.current.handleContentChange("hosted changed");
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockWriteHostedFile).toHaveBeenCalledWith(
      target,
      "index.html",
      "hosted changed",
      "hosted-revision",
    );
    expect(result.current.dirty).toBe(false);
  });

  it("fails closed when a workspace read did not include a revision", async () => {
    mockReadHostedFile.mockResolvedValueOnce({ ok: true, content: "legacy" });
    const target = { projectId: "project-1", agentInstanceId: "instance-1" };
    const { result } = renderHook(() =>
      useIdeViewTabs("index.html", undefined, target),
    );
    await waitFor(() => expect(result.current.activeTab?.content).toBe("legacy"));

    expect(result.current.readOnly).toBe(true);
    act(() => result.current.handleContentChange("changed"));
    expect(result.current.activeTab?.content).toBe("legacy");
    await act(async () => result.current.handleSave());

    expect(mockWriteHostedFile).not.toHaveBeenCalled();
    expect(result.current.saveError).toContain("runtime must be updated");
  });

  it("asks the user to reopen a file when an agent changed it first", async () => {
    mockWriteRemoteFile.mockRejectedValueOnce(new ApiClientError(409, {
      error: "conflict",
      code: "conflict",
      details: null,
    }));
    const { result } = renderHook(() =>
      useIdeViewTabs("/workspace/app.ts", "remote-agent-1"),
    );
    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("remote content");
    });

    act(() => result.current.handleContentChange("browser edit"));
    await act(async () => result.current.handleSave());

    expect(result.current.dirty).toBe(true);
    expect(result.current.saveError).toContain("open the file from Files");
  });

  it("reopens clean files with a fresh read instead of stale cached contents", async () => {
    const { result } = renderHook(() => useIdeViewTabs("/app.ts"));
    await waitFor(() => expect(result.current.activeTab?.content).toBe("local content"));
    act(() => result.current.closeTab("/app.ts"));
    expect(result.current.activeTab).toBeNull();
    expect(result.current.canReopenClosedTab).toBe(true);

    mockReadFile.mockResolvedValueOnce({ ok: true, content: "agent updated" });
    act(() => result.current.reopenClosedTab());
    await waitFor(() => expect(result.current.activeTab?.content).toBe("agent updated"));
    expect(result.current.canReopenClosedTab).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("recovers unsaved edits and their original revision without writing or rereading", async () => {
    const { result } = renderHook(() => useIdeViewTabs("/app.ts", "remote-1"));
    await waitFor(() => expect(result.current.activeTab?.content).toBe("remote content"));
    act(() => result.current.handleContentChange("unsaved changes"));
    act(() => result.current.closeTab("/app.ts"));
    act(() => result.current.reopenClosedTab());
    expect(result.current.activeTab).toMatchObject({
      content: "unsaved changes", savedContent: "remote content", revision: "remote-revision",
    });
    expect(result.current.dirty).toBe(true);
    expect(mockReadRemoteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteRemoteFile).not.toHaveBeenCalled();

    mockWriteRemoteFile.mockRejectedValueOnce(new ApiClientError(409, {
      error: "conflict", code: "conflict", details: null,
    }));
    await act(async () => result.current.handleSave());
    expect(mockWriteRemoteFile).toHaveBeenCalledWith("remote-1", "/app.ts", "unsaved changes", "remote-revision");
    expect(result.current.activeTab?.content).toBe("unsaved changes");
    expect(result.current.dirty).toBe(true);
    expect(result.current.saveError).toContain("Copy your edits");
  });

  it("reopens in last-closed order and restores dirty tabs at their original position", async () => {
    const { result } = renderHook(() => useIdeViewTabs("/a.ts"));
    await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
    act(() => result.current.openTab("/b.ts"));
    await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
    act(() => result.current.handleContentChange("draft b"));
    act(() => result.current.openTab("/c.ts"));
    await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));

    act(() => result.current.closeTab("/b.ts"));
    expect(result.current.activeTabPath).toBe("/c.ts");
    act(() => result.current.closeTab("/c.ts"));
    act(() => result.current.reopenClosedTab());
    await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
    expect(result.current.activeTabPath).toBe("/c.ts");
    act(() => result.current.reopenClosedTab());
    expect(result.current.tabs.map((tab) => tab.path)).toEqual(["/a.ts", "/b.ts", "/c.ts"]);
    expect(result.current.activeTab?.content).toBe("draft b");
    expect(result.current.canReopenClosedTab).toBe(false);
  });

  it("ignores a late read from a closed tab after the same path is reopened", async () => {
    let finishRead!: (result: { ok: boolean; content: string }) => void;
    mockReadFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const { result } = renderHook(() => useIdeViewTabs("/app.ts"));
    act(() => result.current.closeTab("/app.ts"));
    mockReadFile.mockResolvedValueOnce({ ok: true, content: "fresh read" });
    act(() => result.current.reopenClosedTab());
    await waitFor(() => expect(result.current.activeTab?.content).toBe("fresh read"));
    await act(async () => finishRead({ ok: true, content: "stale read" }));
    expect(result.current.activeTab?.content).toBe("fresh read");
  });

  it("does not start duplicate reads for the same path opened in one batch", async () => {
    const { result } = renderHook(() => useIdeViewTabs(""));
    act(() => { result.current.openTab("/app.ts"); result.current.openTab("/app.ts"); });
    await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
    expect(result.current.tabs).toHaveLength(1);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("removes a manual fresh-open from closed history without restoring its draft", async () => {
    const { result } = renderHook(() => useIdeViewTabs("/app.ts"));
    await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
    act(() => result.current.handleContentChange("closed draft"));
    act(() => result.current.closeTab("/app.ts"));
    act(() => result.current.openTab("/app.ts"));
    await waitFor(() => expect(result.current.activeTab?.content).toBe("local content"));
    expect(result.current.canReopenClosedTab).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it("supports Ctrl/Cmd+Shift+T only while there is a closed tab to recover", async () => {
    const { result } = renderHook(() => useIdeViewTabs("/app.ts"));
    await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
    const emptyEvent = new KeyboardEvent("keydown", { key: "T", ctrlKey: true, shiftKey: true, cancelable: true });
    act(() => window.dispatchEvent(emptyEvent));
    expect(emptyEvent.defaultPrevented).toBe(false);

    for (const modifier of ["ctrlKey", "metaKey"]) {
      act(() => result.current.closeTab("/app.ts"));
      const event = new KeyboardEvent("keydown", { key: "T", [modifier]: true, shiftKey: true, cancelable: true });
      act(() => window.dispatchEvent(event));
      await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
      expect(event.defaultPrevented).toBe(true);
      expect(result.current.activeTabPath).toBe("/app.ts");
    }
  });

  it("bounds closed history to ten entries and ignores nonexistent closes", async () => {
    const { result } = renderHook(() => useIdeViewTabs(""));
    act(() => result.current.closeTab("/missing.ts"));
    expect(result.current.canReopenClosedTab).toBe(false);
    for (let index = 0; index < 11; index += 1) {
      act(() => result.current.openTab(`/${index}.ts`));
      await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
      act(() => result.current.closeTab(`/${index}.ts`));
    }
    for (let index = 10; index >= 1; index -= 1) {
      act(() => result.current.reopenClosedTab());
      await waitFor(() => expect(result.current.activeTab?.loading).toBe(false));
      expect(result.current.activeTabPath).toBe(`/${index}.ts`);
    }
    expect(result.current.canReopenClosedTab).toBe(false);
  });
});
