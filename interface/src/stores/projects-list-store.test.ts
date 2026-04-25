import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Project, AgentInstance } from "../shared/types";
import { emptyAgentPermissions } from "../shared/types/permissions-wire";
import { queryClient } from "../shared/lib/query-client";

const { mockApi, mockSessionStorage, mockLocalStorage, mockOrgStoreState } = vi.hoisted(() => {
  const mockSessionStorage: Record<string, string> = {};
  const mockLocalStorage: Record<string, string> = {};
  const mockOrgStoreState: { activeOrg: { org_id: string } | null } = {
    activeOrg: null,
  };
  return {
    mockApi: {
      listProjects: vi.fn().mockResolvedValue([]),
      listAgentInstances: vi.fn().mockResolvedValue([]),
    },
    mockSessionStorage,
    mockLocalStorage,
    mockOrgStoreState,
  };
});

vi.mock("../api/client", () => ({ api: mockApi }));

vi.mock("./org-store", () => ({
  useOrgStore: {
    getState: () => mockOrgStoreState,
    subscribe: vi.fn(() => vi.fn()),
    setState: vi.fn(),
  },
}));

vi.mock("./auth-store", () => ({
  useAuthStore: {
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => mockSessionStorage[key] ?? null,
  setItem: (key: string, val: string) => { mockSessionStorage[key] = val; },
  removeItem: (key: string) => { delete mockSessionStorage[key]; },
});

vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, val: string) => { mockLocalStorage[key] = val; }),
  removeItem: vi.fn((key: string) => { delete mockLocalStorage[key]; }),
});

import {
  applyProjectOrder,
  normalizeProjectOrderIds,
  useProjectsListStore,
  getRecentProjects,
  getMostRecentProject,
  deriveOrgScopedProjectsState,
} from "./projects-list-store";

function makeProject(id: string, updatedAt: string): Project {
  return {
    project_id: id,
    org_id: "org-1",
    name: `Project ${id}`,
    description: "",
    current_status: "active",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: updatedAt,
  };
}

function makeAgentInstance(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    agent_instance_id: "ai1",
    project_id: "p1",
    agent_id: "agent-1",
    org_id: "org-1",
    name: "Agent Alpha",
    role: "dev",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    workspace_path: null,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    permissions: emptyAgentPermissions(),
    intent_classifier: null,
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  queryClient.clear();
  useProjectsListStore.setState({
    projects: [],
    projectsOrgId: null,
    loadingProjects: true,
    projectsError: null,
    agentsByProject: {},
    loadingAgentsByProject: {},
    newProjectModalOpen: false,
  });
  mockOrgStoreState.activeOrg = null;
  for (const key of Object.keys(mockSessionStorage)) delete mockSessionStorage[key];
  for (const key of Object.keys(mockLocalStorage)) delete mockLocalStorage[key];
  vi.clearAllMocks();
});

describe("projects-list-store", () => {
  describe("deriveOrgScopedProjectsState", () => {
    it("recovers an org-scoped snapshot from the all-project cache", () => {
      const orgProject = makeProject("p1", "2025-06-01T00:00:00Z");
      const otherProject = { ...makeProject("p2", "2025-06-02T00:00:00Z"), org_id: "org-2" };
      const orgAgent = makeAgentInstance({ project_id: orgProject.project_id });
      const otherAgent = makeAgentInstance({
        agent_instance_id: "ai2",
        project_id: otherProject.project_id,
      });

      expect(
        deriveOrgScopedProjectsState(
          {
            projects: [orgProject, otherProject],
            agentsByProject: {
              [orgProject.project_id]: [orgAgent],
              [otherProject.project_id]: [otherAgent],
            },
          },
          "org-1",
        ),
      ).toEqual({
        projects: [orgProject],
        agentsByProject: {
          [orgProject.project_id]: [orgAgent],
        },
      });
    });

    it("returns null when the fallback cache has no projects for the active org", () => {
      expect(
        deriveOrgScopedProjectsState(
          {
            projects: [{ ...makeProject("p2", "2025-06-02T00:00:00Z"), org_id: "org-2" }],
            agentsByProject: {},
          },
          "org-1",
        ),
      ).toBeNull();
    });
  });

  describe("initial state", () => {
    it("has empty projects", () => {
      expect(useProjectsListStore.getState().projects).toEqual([]);
    });

    it("is loading projects", () => {
      expect(useProjectsListStore.getState().loadingProjects).toBe(true);
    });

    it("starts without a projects load error", () => {
      expect(useProjectsListStore.getState().projectsError).toBeNull();
    });

    it("modal is closed", () => {
      expect(useProjectsListStore.getState().newProjectModalOpen).toBe(false);
    });
  });

  describe("setProjects", () => {
    it("sets projects from array", () => {
      const p = makeProject("p1", "2025-06-01T00:00:00Z");
      useProjectsListStore.getState().setProjects([p]);
      expect(useProjectsListStore.getState().projects).toEqual([p]);
    });

    it("sets projects from updater function", () => {
      const p1 = makeProject("p1", "2025-06-01T00:00:00Z");
      useProjectsListStore.setState({ projects: [p1] });

      const p2 = makeProject("p2", "2025-06-02T00:00:00Z");
      useProjectsListStore.getState().setProjects((prev) => [...prev, p2]);
      expect(useProjectsListStore.getState().projects).toHaveLength(2);
    });

    it("applies a saved local order and appends new projects", () => {
      mockLocalStorage["aura-project-order:all"] = JSON.stringify(["p2", "p1"]);

      const p1 = makeProject("p1", "2025-06-01T00:00:00Z");
      const p2 = makeProject("p2", "2025-06-02T00:00:00Z");
      const p3 = makeProject("p3", "2025-06-03T00:00:00Z");

      useProjectsListStore.getState().setProjects([p1, p2, p3]);

      expect(useProjectsListStore.getState().projects.map((project) => project.project_id)).toEqual([
        "p2",
        "p1",
        "p3",
      ]);
    });
  });

  describe("saveProjectOrder", () => {
    it("reorders projects and persists the normalized id order", () => {
      const p1 = makeProject("p1", "2025-06-01T00:00:00Z");
      const p2 = makeProject("p2", "2025-06-02T00:00:00Z");
      const p3 = makeProject("p3", "2025-06-03T00:00:00Z");
      useProjectsListStore.setState({ projects: [p1, p2, p3], loadingProjects: false });

      useProjectsListStore.getState().saveProjectOrder(["p3", "p1"]);

      expect(useProjectsListStore.getState().projects.map((project) => project.project_id)).toEqual([
        "p3",
        "p1",
        "p2",
      ]);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "aura-project-order:all",
        JSON.stringify(["p3", "p1", "p2"]),
      );
    });
  });

  describe("refreshProjects", () => {
    it("loads and deduplicates projects", async () => {
      const p = makeProject("p1", "2025-06-01T00:00:00Z");
      mockApi.listProjects.mockResolvedValue([p, p]);
      mockOrgStoreState.activeOrg = { org_id: "org-1" };

      await useProjectsListStore.getState().refreshProjects();

      expect(useProjectsListStore.getState().projects).toHaveLength(1);
      expect(useProjectsListStore.getState().projectsOrgId).toBe("org-1");
      expect(useProjectsListStore.getState().loadingProjects).toBe(false);
    });

    it("handles API failure", async () => {
      mockApi.listProjects.mockRejectedValue(new Error("fail"));

      await useProjectsListStore.getState().refreshProjects();

      expect(useProjectsListStore.getState().loadingProjects).toBe(false);
      expect(useProjectsListStore.getState().projectsError).toBe("fail");
    });

    it("refetches even when a cached project list is still fresh", async () => {
      const cachedProject = makeProject("p1", "2025-06-01T00:00:00Z");
      const renamedProject = {
        ...cachedProject,
        name: "Renamed Project",
        updated_at: "2025-06-02T00:00:00Z",
      };

      queryClient.setQueryData(["projects", "list", "all"], [cachedProject]);
      useProjectsListStore.setState({ projects: [cachedProject], loadingProjects: false });
      mockApi.listProjects.mockResolvedValue([renamedProject]);
      mockOrgStoreState.activeOrg = { org_id: "org-1" };

      await useProjectsListStore.getState().refreshProjects();

      expect(mockApi.listProjects).toHaveBeenCalledTimes(1);
      expect(useProjectsListStore.getState().projects).toEqual([renamedProject]);
    });
  });

  describe("org ownership", () => {
    it("adopts the active org when setting projects for the first time", () => {
      mockOrgStoreState.activeOrg = { org_id: "org-1" };

      useProjectsListStore.getState().setProjects([makeProject("p1", "2025-06-01T00:00:00Z")]);

      expect(useProjectsListStore.getState().projectsOrgId).toBe("org-1");
    });

    it("preserves the org ownership of the current project slice during local updates", () => {
      useProjectsListStore.setState({
        projects: [makeProject("p1", "2025-06-01T00:00:00Z")],
        projectsOrgId: "org-1",
      });
      mockOrgStoreState.activeOrg = { org_id: "org-2" };

      useProjectsListStore.getState().setProjects((previous) => [
        ...previous,
        { ...makeProject("p2", "2025-06-02T00:00:00Z"), org_id: "org-1" },
      ]);

      expect(useProjectsListStore.getState().projectsOrgId).toBe("org-1");
    });
  });

  describe("setAgentsByProject", () => {
    it("sets from object", () => {
      useProjectsListStore.getState().setAgentsByProject({ p1: [] });
      expect(useProjectsListStore.getState().agentsByProject).toEqual({ p1: [] });
    });

    it("sets from updater function", () => {
      useProjectsListStore.setState({ agentsByProject: { p1: [] } });
      useProjectsListStore.getState().setAgentsByProject((prev) => ({
        ...prev,
        p2: [],
      }));
      expect(useProjectsListStore.getState().agentsByProject).toHaveProperty("p2");
    });
  });

  describe("refreshProjectAgents", () => {
    it("loads agents for a project", async () => {
      const agent = makeAgentInstance();
      mockApi.listAgentInstances.mockResolvedValue([agent]);

      const result = await useProjectsListStore.getState().refreshProjectAgents("p1");

      expect(result).toEqual([agent]);
      expect(useProjectsListStore.getState().agentsByProject["p1"]).toEqual([agent]);
    });

    it("handles API failure", async () => {
      mockApi.listAgentInstances.mockRejectedValue(new Error("fail"));

      const result = await useProjectsListStore.getState().refreshProjectAgents("p1");

      expect(result).toEqual([]);
    });

    it("preserves a freshly archived agent when an in-flight refresh resolves stale data", async () => {
      let resolveAgents: ((agents: AgentInstance[]) => void) | undefined;
      mockApi.listAgentInstances.mockReturnValue(
        new Promise<AgentInstance[]>((resolve) => {
          resolveAgents = resolve;
        }),
      );

      const refreshPromise = useProjectsListStore.getState().refreshProjectAgents("p1");
      const archivedAgent = makeAgentInstance({
        status: "archived",
        updated_at: new Date(Date.now() + 1_000).toISOString(),
      });
      useProjectsListStore.getState().setAgentsByProject({ p1: [archivedAgent] });
      resolveAgents?.([]);

      const result = await refreshPromise;

      expect(result).toEqual([archivedAgent]);
      expect(useProjectsListStore.getState().agentsByProject["p1"]).toEqual([archivedAgent]);
    });
  });

  describe("modal actions", () => {
    it("openNewProjectModal opens the modal", () => {
      useProjectsListStore.getState().openNewProjectModal();
      expect(useProjectsListStore.getState().newProjectModalOpen).toBe(true);
    });

    it("closeNewProjectModal closes the modal", () => {
      useProjectsListStore.setState({ newProjectModalOpen: true });
      useProjectsListStore.getState().closeNewProjectModal();
      expect(useProjectsListStore.getState().newProjectModalOpen).toBe(false);
    });
  });

  describe("getRecentProjects", () => {
    it("returns top 3 projects sorted by updated_at descending", () => {
      const p1 = makeProject("p1", "2025-01-01T00:00:00Z");
      const p2 = makeProject("p2", "2025-06-01T00:00:00Z");
      const p3 = makeProject("p3", "2025-03-01T00:00:00Z");
      const p4 = makeProject("p4", "2025-09-01T00:00:00Z");

      const result = getRecentProjects([p1, p2, p3, p4]);
      expect(result).toHaveLength(3);
      expect(result[0].project_id).toBe("p4");
      expect(result[1].project_id).toBe("p2");
    });

    it("returns empty array for no projects", () => {
      expect(getRecentProjects([])).toEqual([]);
    });
  });

  describe("getMostRecentProject", () => {
    it("returns the most recently updated project", () => {
      const p1 = makeProject("p1", "2025-01-01T00:00:00Z");
      const p2 = makeProject("p2", "2025-06-01T00:00:00Z");

      expect(getMostRecentProject([p1, p2])?.project_id).toBe("p2");
    });

    it("returns null for empty list", () => {
      expect(getMostRecentProject([])).toBeNull();
    });
  });

  describe("project order helpers", () => {
    it("normalizes stored order ids against the current project list", () => {
      expect(normalizeProjectOrderIds(["p1", "p2", "p3"], ["p2", "missing"])).toEqual([
        "p2",
        "p1",
        "p3",
      ]);
    });

    it("applies a normalized order to project records", () => {
      const p1 = makeProject("p1", "2025-01-01T00:00:00Z");
      const p2 = makeProject("p2", "2025-06-01T00:00:00Z");

      expect(applyProjectOrder([p1, p2], ["p2", "p1"]).map((project) => project.project_id)).toEqual([
        "p2",
        "p1",
      ]);
    });
  });
});
