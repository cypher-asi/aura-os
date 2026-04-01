import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { projectsApi } from "./projects";
import type { CreateProjectRequest, UpdateProjectRequest, CreateImportedProjectRequest } from "./projects";
import { ApiClientError } from "./core";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: (k: string) => k.toLowerCase() === "content-type" ? "application/json" : null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

describe("projectsApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("listProjects fetches GET /api/projects without orgId", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.listProjects();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.any(Object));
  });

  it("listProjects appends org_id query param", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.listProjects("org-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects?org_id=org-1", expect.any(Object));
  });

  it("createProject sends POST with full body", async () => {
    const data: CreateProjectRequest = {
      org_id: "o1",
      name: "Proj",
      description: "Desc",
    };
    const fetchMock = mockFetch(200, { id: "p1", ...data });
    globalThis.fetch = fetchMock;
    await projectsApi.createProject(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("importProject sends POST to /api/projects/import", async () => {
    const data: CreateImportedProjectRequest = {
      org_id: "o1",
      name: "Imported",
      description: "desc",
      files: [{ relative_path: "main.rs", contents_base64: "Zm9v" }],
    };
    const fetchMock = mockFetch(200, { id: "p2" });
    globalThis.fetch = fetchMock;
    await projectsApi.importProject(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/import",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("getProject fetches by id", async () => {
    const fetchMock = mockFetch(200, { id: "p1", name: "Proj" });
    globalThis.fetch = fetchMock;
    await projectsApi.getProject("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1", expect.any(Object));
  });

  it("listOrbitRepos fetches without query", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.listOrbitRepos();
    expect(fetchMock).toHaveBeenCalledWith("/api/orbit/repos", expect.any(Object));
  });

  it("listOrbitRepos encodes query param", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.listOrbitRepos("my repo");
    expect(fetchMock).toHaveBeenCalledWith("/api/orbit/repos?q=my%20repo", expect.any(Object));
  });

  it("listProjectOrbitCollaborators fetches collaborators", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.listProjectOrbitCollaborators("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/orbit-collaborators", expect.any(Object));
  });

  it("updateProject sends PUT with partial data", async () => {
    const data: UpdateProjectRequest = { name: "Renamed" };
    const fetchMock = mockFetch(200, { id: "p1", name: "Renamed" });
    globalThis.fetch = fetchMock;
    await projectsApi.updateProject("p1" as string, data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(data) }),
    );
  });

  it("deleteProject sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await projectsApi.deleteProject("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("archiveProject sends POST", async () => {
    const fetchMock = mockFetch(200, { id: "p1", archived: true });
    globalThis.fetch = fetchMock;
    await projectsApi.archiveProject("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/archive",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("listSpecs fetches specs", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.listSpecs("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/specs", expect.any(Object));
  });

  it("getSpec fetches by projectId and specId", async () => {
    const fetchMock = mockFetch(200, { id: "s1" });
    globalThis.fetch = fetchMock;
    await projectsApi.getSpec("p1" as string, "s1" as string);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/specs/s1", expect.any(Object));
  });

  it("generateSpecs sends POST", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.generateSpecs("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/specs/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("generateSpecs appends agent_instance_id when provided", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await projectsApi.generateSpecs("p1" as string, "ai 1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/specs/generate?agent_instance_id=ai%201",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(404, { error: "Not found", code: "not_found", details: null });
    await expect(projectsApi.getProject("nope" as string)).rejects.toThrow(ApiClientError);
  });
});
