import { afterEach, describe, expect, it, vi } from "vitest";
import { hostedWorkspaceApi } from "./hosted-workspace";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJson(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

describe("hostedWorkspaceApi", () => {
  it("scopes file listings to both project and agent instance", async () => {
    const fetchMock = mockJson({ ok: true, entries: [] });
    globalThis.fetch = fetchMock;

    await hostedWorkspaceApi.listFiles({
      projectId: "project/one",
      agentInstanceId: "agent instance",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%2Fone/agents/agent%20instance/workspace/files",
      expect.any(Object),
    );
  });

  it("encodes workspace-relative read paths", async () => {
    const fetchMock = mockJson({ ok: true, content: "hello" });
    globalThis.fetch = fetchMock;

    await hostedWorkspaceApi.readFile(
      { projectId: "project-1", agentInstanceId: "instance-1" },
      "src/pages/home view.tsx",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/agents/instance-1/workspace/read-file?path=src%2Fpages%2Fhome%20view.tsx",
      expect.any(Object),
    );
  });

  it("writes UTF-8 content with its expected revision", async () => {
    const fetchMock = mockJson({ ok: true, revision: "next" });
    globalThis.fetch = fetchMock;

    await hostedWorkspaceApi.writeFile(
      { projectId: "project-1", agentInstanceId: "instance-1" },
      "src/app.ts",
      "hello 🌎",
      "revision-1",
    );

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(options.body));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/agents/instance-1/workspace/write-file",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(body.path).toBe("src/app.ts");
    expect(body.expected_revision).toBe("revision-1");
    expect(new TextDecoder().decode(
      Uint8Array.from(atob(body.content_base64), (char) => char.charCodeAt(0)),
    )).toBe("hello 🌎");
  });
});
