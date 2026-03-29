import {
  getProjectWorkspaceRoot,
  getLinkedWorkspaceRoot,
  hasLinkedWorkspace,
} from "./projectWorkspace";

type WorkspaceProject = Parameters<typeof getProjectWorkspaceRoot>[0];

describe("getProjectWorkspaceRoot", () => {
  it("returns the linked_folder_path when set", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "/home/user/project",
      workspace_source: "local",
    };
    expect(getProjectWorkspaceRoot(project)).toBe("/home/user/project");
  });

  it("returns null for empty linked_folder_path", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "",
      workspace_source: "local",
    };
    expect(getProjectWorkspaceRoot(project)).toBeNull();
  });

  it("returns null for whitespace-only linked_folder_path", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "   ",
      workspace_source: "local",
    };
    expect(getProjectWorkspaceRoot(project)).toBeNull();
  });

  it("returns null for null project", () => {
    expect(getProjectWorkspaceRoot(null)).toBeNull();
  });

  it("returns null for undefined project", () => {
    expect(getProjectWorkspaceRoot(undefined)).toBeNull();
  });
});

describe("getLinkedWorkspaceRoot", () => {
  it("returns path for non-imported workspace", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "/path/to/project",
      workspace_source: "local",
    };
    expect(getLinkedWorkspaceRoot(project)).toBe("/path/to/project");
  });

  it("returns null for imported workspace", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "/path/to/project",
      workspace_source: "imported",
    };
    expect(getLinkedWorkspaceRoot(project)).toBeNull();
  });

  it("returns null when no linked_folder_path", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "",
      workspace_source: "local",
    };
    expect(getLinkedWorkspaceRoot(project)).toBeNull();
  });

  it("returns path when workspace_source is undefined", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "/path",
    };
    expect(getLinkedWorkspaceRoot(project)).toBe("/path");
  });

  it("returns null for null project", () => {
    expect(getLinkedWorkspaceRoot(null)).toBeNull();
  });
});

describe("hasLinkedWorkspace", () => {
  it("returns true for linked non-imported project", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "/path",
      workspace_source: "local",
    };
    expect(hasLinkedWorkspace(project)).toBe(true);
  });

  it("returns false for imported project", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "/path",
      workspace_source: "imported",
    };
    expect(hasLinkedWorkspace(project)).toBe(false);
  });

  it("returns false for null project", () => {
    expect(hasLinkedWorkspace(null)).toBe(false);
  });

  it("returns false when no linked path", () => {
    const project: WorkspaceProject = {
      linked_folder_path: "",
    };
    expect(hasLinkedWorkspace(project)).toBe(false);
  });
});
