import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { harnessSkillsApi } from "./harness-skills";
import { ApiClientError } from "./core";

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
  };
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: (k: string) => k.toLowerCase() === "content-type" ? "application/json" : null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

const originalFetch = globalThis.fetch;
const originalLocalStorage = window.localStorage;

describe("harnessSkillsApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      value: createStorageMock(),
      configurable: true,
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("listSkills fetches GET /api/harness/skills", async () => {
    const skills = [{ name: "code-review" }];
    const fetchMock = mockFetch(200, skills);
    globalThis.fetch = fetchMock;
    const result = await harnessSkillsApi.listSkills();
    expect(result).toEqual(skills);
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/skills", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("listMySkills fetches GET /api/harness/skills/mine", async () => {
    const mine = [
      {
        name: "my-skill",
        description: "mine",
        path: "/root/.aura/skills/my-skill/SKILL.md",
        user_invocable: true,
        model_invocable: false,
      },
    ];
    const fetchMock = mockFetch(200, mine);
    globalThis.fetch = fetchMock;
    const result = await harnessSkillsApi.listMySkills();
    expect(result).toEqual(mine);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/skills/mine",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("getSkill fetches skill by name", async () => {
    const fetchMock = mockFetch(200, { name: "code-review" });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.getSkill("code-review");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/skills/code-review", expect.any(Object));
  });

  it("createSkill sends POST with skill data", async () => {
    const data = { name: "new-skill", description: "A skill" };
    const fetchMock = mockFetch(200, {
      name: "new-skill",
      path: "/skills/new-skill",
      created: true,
      registered: true,
      installed_on_agent: false,
    });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.createSkill(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/skills",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("createSkill forwards agent_id so the skill auto-installs on that agent", async () => {
    const data = { name: "scoped-skill", description: "Agent-scoped", agent_id: "a1" };
    const fetchMock = mockFetch(200, {
      name: "scoped-skill",
      path: "/skills/scoped-skill",
      created: true,
      registered: true,
      installed_on_agent: true,
    });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.createSkill(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/skills",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("activateSkill sends POST with arguments", async () => {
    const fetchMock = mockFetch(200, { result: "done" });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.activateSkill("code-review", "file.ts");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/skills/code-review/activate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ arguments: "file.ts" }),
      }),
    );
  });

  it("activateSkill sends POST without arguments", async () => {
    const fetchMock = mockFetch(200, { result: "done" });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.activateSkill("code-review");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/skills/code-review/activate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ arguments: undefined }),
      }),
    );
  });

  it("listAgentSkills fetches skills for an agent", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.listAgentSkills("a1");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/skills", expect.any(Object));
  });

  it("installAgentSkill sends POST with install data", async () => {
    const fetchMock = mockFetch(200, { name: "code-review", agent_id: "a1" });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.installAgentSkill("a1", "code-review", "https://example.com", ["/src"], ["npm test"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/skills",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "code-review",
          source_url: "https://example.com",
          approved_paths: ["/src"],
          approved_commands: ["npm test"],
        }),
      }),
    );
  });

  it("installAgentSkill defaults optional arrays to empty", async () => {
    const fetchMock = mockFetch(200, { name: "sk", agent_id: "a1" });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.installAgentSkill("a1", "sk");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/skills",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "sk",
          source_url: undefined,
          approved_paths: [],
          approved_commands: [],
        }),
      }),
    );
  });

  it("uninstallAgentSkill sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.uninstallAgentSkill("a1", "code-review");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/skills/code-review",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteMySkill sends DELETE /api/harness/skills/mine/:name", async () => {
    const fetchMock = mockFetch(200, { name: "my-skill", deleted: true });
    globalThis.fetch = fetchMock;
    const result = await harnessSkillsApi.deleteMySkill("my-skill");
    expect(result).toEqual({ name: "my-skill", deleted: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/skills/mine/my-skill",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("installFromShop sends POST with name and category", async () => {
    const fetchMock = mockFetch(200, { name: "web-search", path: "/skills/web-search", installed: true });
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.installFromShop("web-search", "utility");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/skills/install-from-shop",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "web-search", category: "utility" }),
      }),
    );
  });

  it("getSkillContent fetches skill content by category and name", async () => {
    const fetchMock = mockFetch(200, "skill body content");
    globalThis.fetch = fetchMock;
    await harnessSkillsApi.getSkillContent("utility", "web-search");
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/utility/web-search/content", expect.any(Object));
  });

  it("propagates ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "Server error", code: "internal", details: null });
    await expect(harnessSkillsApi.listSkills()).rejects.toThrow(ApiClientError);
  });
});
