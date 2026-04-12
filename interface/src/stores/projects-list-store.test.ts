import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Project, AgentInstance } from "../types";

const { mockApi, mockSessionStorage } = vi.hoisted(() => {
  const mockSessionStorage: Record<string, string> = {};
  return {
    mockApi: {
      listProjects: vi.fn().mockResolvedValue([]),
      listAgentInstances: vi.fn().mockResolvedValue([]),
    },
    mockSessionStorage,
  };
});

vi.mock("../api/client", () => ({ api: mockApi }));

vi.mock("./org-store", () => ({
  useOrgStore: {
    getState: () => ({ activeOrg: null }),
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

import {
  useProjectsListStore,
  getRecentProjects,
  getMostRecentProject,
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

beforeEach(() => {
  useProjectsListStore.setState({
    projects: [],
    loadingProjects: true,
    agentsByProject: {},
    loadingAgentsByProject: {},
    newProjectModalOpen: false,
  });
  for (const key of Object.keys(mockSessionStorage)) delete mockSessionStorage[key];
  vi.clearAllMocks();
});

describe("projects-list-store", () => {
  describe("initial state", () => {
    it("has empty projects", () => {
      expect(useProjectsListStore.getState().projects).toEqual([]);
    });

    it("is loading projects", () => {
      expect(useProjectsListStore.getState().loadingProjects).toBe(true);
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
  });

  describe("refreshProjects", () => {
    it("loads and deduplicates projects", async () => {
      const p = makeProject("p1", "2025-06-01T00:00:00Z");
      mockApi.listProjects.mockResolvedValue([p, p]);

      await useProjectsListStore.getState().refreshProjects();

      expect(useProjectsListStore.getState().projects).toHaveLength(1);
      expect(useProjectsListStore.getState().loadingProjects).toBe(false);
    });

    it("handles API failure", async () => {
      mockApi.listProjects.mockRejectedValue(new Error("fail"));

      await useProjectsListStore.getState().refreshProjects();

      expect(useProjectsListStore.getState().loadingProjects).toBe(false);
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
      const agent = { agent_instance_id: "ai1" } as AgentInstance;
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
});
