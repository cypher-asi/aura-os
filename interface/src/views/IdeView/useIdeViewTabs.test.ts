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
    expect(result.current.saveError).toContain("Close and reopen it");
  });
});
