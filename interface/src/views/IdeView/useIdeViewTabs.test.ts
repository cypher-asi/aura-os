import { act, renderHook, waitFor } from "@testing-library/react";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockReadRemoteFile = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    swarm: {
      readRemoteFile: (...args: unknown[]) => mockReadRemoteFile(...args),
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
});
