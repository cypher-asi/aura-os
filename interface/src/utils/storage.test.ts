import {
  addRecentLoginEmail,
  clearLastChatRoute,
  clearLastAgentIf,
  getLastChatRoute,
  getLastAgent,
  getLastProject,
  getProjectOrder,
  getRecentLoginEmails,
  getTaskbarAppOrder,
  getTaskbarAppsCollapsed,
  getTaskbarRightCollapsed,
  removeRecentLoginEmail,
  setLastChatRoute,
  setLastAgent,
  setLastProject,
  setProjectOrder,
  setTaskbarAppOrder,
  setTaskbarAppsCollapsed,
  setTaskbarRightCollapsed,
} from "./storage";

const LAST_AGENT_KEY = "aura-last-agent";
const LAST_PROJECT_KEY = "aura-last-project";
const PROJECT_ORDER_KEY = "aura-project-order";
const TASKBAR_APP_ORDER_KEY = "aura-taskbar-app-order";
const TASKBAR_APPS_COLLAPSED_KEY = "aura-taskbar-apps-collapsed";
const TASKBAR_RIGHT_COLLAPSED_KEY = "aura-taskbar-right-collapsed";
const RECENT_LOGIN_EMAILS_KEY = "aura-recent-login-emails";
const LAST_CHAT_ROUTE_KEY = "aura:lastChatRoute";

describe("storage", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getLastAgent", () => {
    it("returns null when no data stored", () => {
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns agentInstanceId for the given project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-2" });
      expect(getLastAgent("p1")).toBe("ai-1");
      expect(getLastAgent("p2")).toBe("ai-2");
    });

    it("returns null for an unknown project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      expect(getLastAgent("p999")).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      store[LAST_AGENT_KEY] = "not-json";
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns null for non-object values", () => {
      store[LAST_AGENT_KEY] = JSON.stringify([1, 2, 3]);
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns null for empty object", () => {
      store[LAST_AGENT_KEY] = "{}";
      expect(getLastAgent("p1")).toBeNull();
    });
  });

  describe("setLastAgent", () => {
    it("stores a single project entry", () => {
      setLastAgent("p1", "ai-1");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-1" }),
      );
    });

    it("preserves entries for other projects", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      setLastAgent("p2", "ai-2");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-1", p2: "ai-2" }),
      );
    });

    it("overwrites the entry for an existing project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      setLastAgent("p1", "ai-99");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-99" }),
      );
    });
  });

  describe("clearLastAgentIf", () => {
    it("removes entry when projectId matches", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-2" });
      clearLastAgentIf({ projectId: "p1" });
      expect(store[LAST_AGENT_KEY]).toBe(JSON.stringify({ p2: "ai-2" }));
    });

    it("removes all entries matching agentInstanceId", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-1", p3: "ai-3" });
      clearLastAgentIf({ agentInstanceId: "ai-1" });
      expect(store[LAST_AGENT_KEY]).toBe(JSON.stringify({ p3: "ai-3" }));
    });

    it("removes localStorage key entirely when map becomes empty", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      clearLastAgentIf({ projectId: "p1" });
      expect(localStorage.removeItem).toHaveBeenCalledWith(LAST_AGENT_KEY);
    });

    it("does not modify storage when nothing matches", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      clearLastAgentIf({ projectId: "p2" });
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(localStorage.removeItem).not.toHaveBeenCalled();
    });

    it("handles missing localStorage data gracefully", () => {
      expect(() => clearLastAgentIf({ projectId: "p1" })).not.toThrow();
    });

    it("handles malformed JSON gracefully", () => {
      store[LAST_AGENT_KEY] = "bad-json";
      expect(() => clearLastAgentIf({ projectId: "p1" })).not.toThrow();
    });
  });

  describe("getLastProject", () => {
    it("returns null when no data stored", () => {
      expect(getLastProject()).toBeNull();
    });

    it("returns the stored project id", () => {
      store[LAST_PROJECT_KEY] = "p1";
      expect(getLastProject()).toBe("p1");
    });
  });

  describe("setLastProject", () => {
    it("stores the project id in localStorage", () => {
      setLastProject("p1");
      expect(localStorage.setItem).toHaveBeenCalledWith(LAST_PROJECT_KEY, "p1");
    });

    it("overwrites the previous value", () => {
      store[LAST_PROJECT_KEY] = "p1";
      setLastProject("p2");
      expect(localStorage.setItem).toHaveBeenCalledWith(LAST_PROJECT_KEY, "p2");
    });
  });

  describe("last chat route", () => {
    it("stores and returns only concrete chat session routes", () => {
      setLastChatRoute("/chat?project=p1&instance=i1&session=s1&agent=a1");

      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_CHAT_ROUTE_KEY,
        "/chat?project=p1&instance=i1&session=s1&agent=a1",
      );
      expect(getLastChatRoute()).toBe(
        "/chat?project=p1&instance=i1&session=s1&agent=a1",
      );
    });

    it("ignores bare, fresh, or incomplete chat routes", () => {
      setLastChatRoute("/chat");
      setLastChatRoute("/chat?fresh=abc");
      setLastChatRoute("/chat?session=s1");
      setLastChatRoute("/chat?project=p1&instance=i1&session=s1");

      expect(localStorage.setItem).not.toHaveBeenCalledWith(
        LAST_CHAT_ROUTE_KEY,
        expect.any(String),
      );
      expect(getLastChatRoute()).toBeNull();
    });

    it("clears invalid stored routes on read", () => {
      store[LAST_CHAT_ROUTE_KEY] = "/projects/p1/agents/i1";

      expect(getLastChatRoute()).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith(LAST_CHAT_ROUTE_KEY);
    });

    it("clears the remembered chat route", () => {
      store[LAST_CHAT_ROUTE_KEY] = "/chat?session=s1";

      clearLastChatRoute();

      expect(localStorage.removeItem).toHaveBeenCalledWith(LAST_CHAT_ROUTE_KEY);
    });
  });

  describe("getTaskbarAppsCollapsed", () => {
    it("defaults to collapsed when nothing is stored", () => {
      expect(getTaskbarAppsCollapsed()).toBe(true);
    });

    it("returns true when the collapsed state is stored", () => {
      store[TASKBAR_APPS_COLLAPSED_KEY] = "true";
      expect(getTaskbarAppsCollapsed()).toBe(true);
    });

    it("returns false when the expanded state is stored", () => {
      store[TASKBAR_APPS_COLLAPSED_KEY] = "false";
      expect(getTaskbarAppsCollapsed()).toBe(false);
    });

    it("falls back to collapsed for malformed values", () => {
      store[TASKBAR_APPS_COLLAPSED_KEY] = "maybe";
      expect(getTaskbarAppsCollapsed()).toBe(true);
    });
  });

  describe("getProjectOrder", () => {
    it("defaults to an empty order when nothing is stored", () => {
      expect(getProjectOrder("org-1")).toEqual([]);
    });

    it("returns the stored order for the given org", () => {
      store[`${PROJECT_ORDER_KEY}:org-1`] = JSON.stringify(["p2", "p1"]);
      store[`${PROJECT_ORDER_KEY}:org-2`] = JSON.stringify(["p9"]);

      expect(getProjectOrder("org-1")).toEqual(["p2", "p1"]);
    });

    it("filters out non-string values", () => {
      store[`${PROJECT_ORDER_KEY}:org-1`] = JSON.stringify(["p2", 5, "p1", null]);

      expect(getProjectOrder("org-1")).toEqual(["p2", "p1"]);
    });

    it("falls back to an empty order for malformed JSON", () => {
      store[`${PROJECT_ORDER_KEY}:org-1`] = "not-json";

      expect(getProjectOrder("org-1")).toEqual([]);
    });
  });

  describe("setProjectOrder", () => {
    it("stores the order under an org-scoped key", () => {
      setProjectOrder("org-1", ["p2", "p1"]);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        `${PROJECT_ORDER_KEY}:org-1`,
        JSON.stringify(["p2", "p1"]),
      );
    });

    it("removes the org key when the order is empty", () => {
      setProjectOrder("org-1", []);

      expect(localStorage.removeItem).toHaveBeenCalledWith(`${PROJECT_ORDER_KEY}:org-1`);
    });

    it("uses the shared fallback scope when org is missing", () => {
      setProjectOrder(null, ["p2"]);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        `${PROJECT_ORDER_KEY}:all`,
        JSON.stringify(["p2"]),
      );
    });
  });

  describe("setTaskbarAppsCollapsed", () => {
    it("stores the collapsed state", () => {
      setTaskbarAppsCollapsed(true);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_APPS_COLLAPSED_KEY, "true");
    });

    it("stores the expanded state", () => {
      setTaskbarAppsCollapsed(false);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_APPS_COLLAPSED_KEY, "false");
    });
  });

  describe("getTaskbarRightCollapsed", () => {
    it("defaults to collapsed when nothing is stored", () => {
      expect(getTaskbarRightCollapsed()).toBe(true);
    });

    it("returns true when the collapsed state is stored", () => {
      store[TASKBAR_RIGHT_COLLAPSED_KEY] = "true";
      expect(getTaskbarRightCollapsed()).toBe(true);
    });

    it("returns false when the expanded state is stored", () => {
      store[TASKBAR_RIGHT_COLLAPSED_KEY] = "false";
      expect(getTaskbarRightCollapsed()).toBe(false);
    });

    it("falls back to collapsed for malformed values", () => {
      store[TASKBAR_RIGHT_COLLAPSED_KEY] = "maybe";
      expect(getTaskbarRightCollapsed()).toBe(true);
    });
  });

  describe("setTaskbarRightCollapsed", () => {
    it("stores the collapsed state", () => {
      setTaskbarRightCollapsed(true);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_RIGHT_COLLAPSED_KEY, "true");
    });

    it("stores the expanded state", () => {
      setTaskbarRightCollapsed(false);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_RIGHT_COLLAPSED_KEY, "false");
    });
  });

  describe("getTaskbarAppOrder", () => {
    it("defaults to an empty order when nothing is stored", () => {
      expect(getTaskbarAppOrder()).toEqual([]);
    });

    it("returns the stored app order", () => {
      store[TASKBAR_APP_ORDER_KEY] = JSON.stringify(["tasks", "agents"]);
      expect(getTaskbarAppOrder()).toEqual(["tasks", "agents"]);
    });

    it("filters out non-string values", () => {
      store[TASKBAR_APP_ORDER_KEY] = JSON.stringify(["tasks", 5, "agents", null]);
      expect(getTaskbarAppOrder()).toEqual(["tasks", "agents"]);
    });

    it("falls back to an empty order for malformed JSON", () => {
      store[TASKBAR_APP_ORDER_KEY] = "not-json";
      expect(getTaskbarAppOrder()).toEqual([]);
    });
  });

  describe("setTaskbarAppOrder", () => {
    it("stores the app order", () => {
      setTaskbarAppOrder(["tasks", "agents"]);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        TASKBAR_APP_ORDER_KEY,
        JSON.stringify(["tasks", "agents"]),
      );
    });

    it("removes the key when the order is empty", () => {
      setTaskbarAppOrder([]);
      expect(localStorage.removeItem).toHaveBeenCalledWith(TASKBAR_APP_ORDER_KEY);
    });
  });

  describe("recent login emails", () => {
    it("returns an empty list when nothing is stored", () => {
      expect(getRecentLoginEmails()).toEqual([]);
    });

    it("returns stored emails and ignores blanks/non-strings", () => {
      store[RECENT_LOGIN_EMAILS_KEY] = JSON.stringify([
        "alice@example.com",
        "  ",
        42,
        "bob@example.com",
      ]);
      expect(getRecentLoginEmails()).toEqual([
        "alice@example.com",
        "bob@example.com",
      ]);
    });

    it("falls back to an empty list for malformed JSON", () => {
      store[RECENT_LOGIN_EMAILS_KEY] = "not-json";
      expect(getRecentLoginEmails()).toEqual([]);
    });

    it("prepends the most-recent email", () => {
      addRecentLoginEmail("alice@example.com");
      addRecentLoginEmail("bob@example.com");
      expect(getRecentLoginEmails()).toEqual([
        "bob@example.com",
        "alice@example.com",
      ]);
    });

    it("dedupes case-insensitively and moves the reused email to the front", () => {
      addRecentLoginEmail("alice@example.com");
      addRecentLoginEmail("bob@example.com");
      addRecentLoginEmail("ALICE@example.com");
      expect(getRecentLoginEmails()).toEqual([
        "ALICE@example.com",
        "bob@example.com",
      ]);
    });

    it("ignores blank emails", () => {
      addRecentLoginEmail("   ");
      expect(getRecentLoginEmails()).toEqual([]);
    });

    it("caps the list at five entries", () => {
      for (let i = 0; i < 7; i++) addRecentLoginEmail(`user${i}@example.com`);
      const emails = getRecentLoginEmails();
      expect(emails).toHaveLength(5);
      expect(emails[0]).toBe("user6@example.com");
      expect(emails).not.toContain("user0@example.com");
    });

    it("removes a specific email case-insensitively", () => {
      addRecentLoginEmail("alice@example.com");
      addRecentLoginEmail("bob@example.com");
      removeRecentLoginEmail("ALICE@EXAMPLE.COM");
      expect(getRecentLoginEmails()).toEqual(["bob@example.com"]);
    });

    it("clears the key once the last email is removed", () => {
      addRecentLoginEmail("alice@example.com");
      removeRecentLoginEmail("alice@example.com");
      expect(localStorage.removeItem).toHaveBeenCalledWith(RECENT_LOGIN_EMAILS_KEY);
      expect(getRecentLoginEmails()).toEqual([]);
    });
  });
});
