import { act, renderHook, waitFor } from "@testing-library/react";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockReadRemoteFile = vi.fn();
const mockReadHostedFile = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    swarm: {
      readRemoteFile: (...args: unknown[]) => mockReadRemoteFile(...args),
    },
    hostedWorkspace: {
      readFile: (...args: unknown[]) => mockReadHostedFile(...args),
    },
  },
}));

import { useIdeViewTabs } from "./useIdeViewTabs";

describe("useIdeViewTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue({ ok: true, content: "local content" });
    mockWriteFile.mockResolvedValue({ ok: true });
    mockReadRemoteFile.mockResolvedValue({ ok: true, content: "remote content" });
    mockReadHostedFile.mockResolvedValue({ ok: true, content: "hosted content" });
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

  it("keeps remote IDE tabs read-only and never calls the local write API", async () => {
    const { result } = renderHook(() =>
      useIdeViewTabs("/workspace/app.ts", "remote-agent-1"),
    );

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("remote content");
    });

    expect(result.current.readOnly).toBe(true);
    expect(result.current.readOnlyReason).toContain("read-only");

    act(() => {
      result.current.handleContentChange("remote changed");
    });

    expect(result.current.activeTab?.content).toBe("remote content");

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(result.current.saveError).toContain("read-only");
  });

  it("reads hosted files through the scoped API and keeps them read-only", async () => {
    const target = { projectId: "project-1", agentInstanceId: "instance-1" };
    const { result } = renderHook(() =>
      useIdeViewTabs("index.html", undefined, target),
    );

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("hosted content");
    });

    expect(mockReadHostedFile).toHaveBeenCalledWith(target, "index.html");
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(result.current.readOnly).toBe(true);
    expect(result.current.readOnlyReason).toContain("Hosted workspace");
  });
});
