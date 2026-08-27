import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sourceControlApi } from "./source-control";

function mockFetch(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

describe("sourceControlApi", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: { getItem: vi.fn(() => null) },
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads project status for a specific agent instance", async () => {
    const fetchMock = mockFetch({ available: true, files: [] });
    globalThis.fetch = fetchMock;

    await sourceControlApi.getStatus("project one", "agent/one");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20one/source-control?agent_instance_id=agent%2Fone",
      expect.any(Object),
    );
  });

  it("encodes diff paths and areas as query parameters", async () => {
    const fetchMock = mockFetch({ diff: "" });
    globalThis.fetch = fetchMock;

    await sourceControlApi.getDiff(
      "project-1",
      "src/file name.ts",
      "worktree",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/source-control/diff?path=src%2Ffile+name.ts&area=worktree",
      expect.any(Object),
    );
  });

  it("sends selected paths to stage and unstage", async () => {
    const fetchMock = mockFetch({ ok: true });
    globalThis.fetch = fetchMock;

    await sourceControlApi.stage("project-1", ["src/a.ts"], "agent-1");
    await sourceControlApi.unstage("project-1", ["src/a.ts"]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects/project-1/source-control/stage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          paths: ["src/a.ts"],
          agent_instance_id: "agent-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project-1/source-control/unstage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ paths: ["src/a.ts"] }),
      }),
    );
  });

  it("sends a commit message", async () => {
    const fetchMock = mockFetch({ ok: true, commit: "abc123" });
    globalThis.fetch = fetchMock;

    await sourceControlApi.commit("project-1", "Ship source control");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/source-control/commit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "Ship source control" }),
      }),
    );
  });
});
