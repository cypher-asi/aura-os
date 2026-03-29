import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProjectActionStore } from "./project-action-store";
import type { ProjectActions } from "./project-action-store";
import type { Project } from "../types";

const mockProject: Project = {
  project_id: "p1",
  org_id: "org-1",
  name: "My Project",
  description: "A project",
  linked_folder_path: "/path",
  current_status: "active",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

function makeProjectActions(overrides: Partial<ProjectActions> = {}): ProjectActions {
  return {
    project: mockProject,
    setProject: vi.fn(),
    message: "",
    handleArchive: vi.fn(),
    navigateToExecution: vi.fn(),
    initialSpecs: [],
    initialTasks: [],
    ...overrides,
  };
}

beforeEach(() => {
  useProjectActionStore.setState({ actions: null });
});

describe("project-action-store", () => {
  describe("initial state", () => {
    it("has null actions", () => {
      expect(useProjectActionStore.getState().actions).toBeNull();
    });
  });

  describe("register", () => {
    it("sets actions", () => {
      const actions = makeProjectActions();
      useProjectActionStore.getState().register(actions);
      expect(useProjectActionStore.getState().actions).toBe(actions);
    });
  });

  describe("unregister", () => {
    it("clears actions", () => {
      useProjectActionStore.getState().register(makeProjectActions());
      useProjectActionStore.getState().unregister();
      expect(useProjectActionStore.getState().actions).toBeNull();
    });
  });
});
