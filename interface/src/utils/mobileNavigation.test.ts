import {
  getProjectIdFromPathname,
  getMobileProjectDestination,
  getMobileShellMode,
  projectRootPath,
  projectAgentRoute,
  projectAgentChatRoute,
  projectWorkRoute,
  projectFilesRoute,
  projectStatsRoute,
  isProjectSubroute,
} from "./mobileNavigation";

describe("getProjectIdFromPathname", () => {
  it("extracts project ID from /projects/:id", () => {
    expect(getProjectIdFromPathname("/projects/abc-123")).toBe("abc-123");
  });

  it("extracts project ID from /projects/:id/sub", () => {
    expect(getProjectIdFromPathname("/projects/abc-123/work")).toBe("abc-123");
  });

  it("returns null for non-project paths", () => {
    expect(getProjectIdFromPathname("/feed")).toBeNull();
    expect(getProjectIdFromPathname("/profile")).toBeNull();
    expect(getProjectIdFromPathname("/")).toBeNull();
  });

  it("returns null for /projects without ID", () => {
    expect(getProjectIdFromPathname("/projects")).toBeNull();
    expect(getProjectIdFromPathname("/projects/")).toBeNull();
  });
});

describe("getMobileProjectDestination", () => {
  it("returns feed for /feed paths", () => {
    expect(getMobileProjectDestination("/feed")).toBe("feed");
    expect(getMobileProjectDestination("/feed/activity")).toBe("feed");
  });

  it("returns tasks for /projects/:id/work", () => {
    expect(getMobileProjectDestination("/projects/p1/work")).toBe("tasks");
  });

  it("returns tasks for /projects/:id/execution", () => {
    expect(getMobileProjectDestination("/projects/p1/execution")).toBe("tasks");
  });

  it("returns files for /projects/:id/files", () => {
    expect(getMobileProjectDestination("/projects/p1/files")).toBe("files");
  });

  it("returns stats for /projects/:id/stats", () => {
    expect(getMobileProjectDestination("/projects/p1/stats")).toBe("stats");
  });

  it("returns agent for /projects/:id/agent", () => {
    expect(getMobileProjectDestination("/projects/p1/agent")).toBe("agent");
  });

  it("returns agent for /projects/:id/agents/:agentId", () => {
    expect(getMobileProjectDestination("/projects/p1/agents/a1")).toBe("agent");
  });

  it("returns null for /projects/:id with no suffix", () => {
    expect(getMobileProjectDestination("/projects/p1")).toBeNull();
  });

  it("returns null for non-matching paths", () => {
    expect(getMobileProjectDestination("/other")).toBeNull();
    expect(getMobileProjectDestination("/")).toBeNull();
  });

  it("returns null for unknown sub-routes", () => {
    expect(getMobileProjectDestination("/projects/p1/unknown")).toBeNull();
  });
});

describe("getMobileShellMode", () => {
  it("returns global for /projects list", () => {
    expect(getMobileShellMode("/projects", null, false)).toBe("global");
  });

  it("returns global for /feed", () => {
    expect(getMobileShellMode("/feed", null, false)).toBe("global");
  });

  it("returns global for /profile", () => {
    expect(getMobileShellMode("/profile", null, false)).toBe("global");
  });

  it("returns project when currentProjectId is set and resolved", () => {
    expect(getMobileShellMode("/projects/p1/work", "p1", true)).toBe("project");
  });

  it("returns global when project not resolved", () => {
    expect(getMobileShellMode("/projects/p1/work", "p1", false)).toBe("global");
  });

  it("returns global when no current project", () => {
    expect(getMobileShellMode("/projects/p1/work", null, true)).toBe("global");
  });
});

describe("route helpers", () => {
  it("projectRootPath builds correct path", () => {
    expect(projectRootPath("p1")).toBe("/projects/p1");
  });

  it("projectAgentRoute builds correct path", () => {
    expect(projectAgentRoute("p1")).toBe("/projects/p1/agent");
  });

  it("projectAgentChatRoute builds correct path", () => {
    expect(projectAgentChatRoute("p1", "ai-1")).toBe("/projects/p1/agents/ai-1");
  });

  it("projectWorkRoute builds correct path", () => {
    expect(projectWorkRoute("p1")).toBe("/projects/p1/work");
  });

  it("projectFilesRoute builds correct path", () => {
    expect(projectFilesRoute("p1")).toBe("/projects/p1/files");
  });

  it("projectStatsRoute builds correct path", () => {
    expect(projectStatsRoute("p1")).toBe("/projects/p1/stats");
  });
});

describe("isProjectSubroute", () => {
  it("returns true for matching project subroute", () => {
    expect(isProjectSubroute("/projects/p1/work", "p1")).toBe(true);
  });

  it("returns false for different project", () => {
    expect(isProjectSubroute("/projects/p2/work", "p1")).toBe(false);
  });

  it("returns false for null projectId", () => {
    expect(isProjectSubroute("/projects/p1/work", null)).toBe(false);
  });

  it("returns false for project root (no trailing slash sub-path)", () => {
    expect(isProjectSubroute("/projects/p1", "p1")).toBe(false);
  });
});
