import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  followsApi,
  usersApi,
  profilesApi,
  feedApi,
  leaderboardApi,
  platformStatsApi,
  usageApi,
  activityApi,
} from "./social";
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

describe("followsApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("follow sends POST with target_profile_id", async () => {
    const fetchMock = mockFetch(200, { id: "f1" });
    globalThis.fetch = fetchMock;
    await followsApi.follow("prof-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/follows",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ target_profile_id: "prof-1" }) }),
    );
  });

  it("unfollow sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await followsApi.unfollow("prof-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/follows/prof-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("list fetches GET /api/follows", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await followsApi.list();
    expect(fetchMock).toHaveBeenCalledWith("/api/follows", expect.any(Object));
  });

  it("check fetches follow status", async () => {
    const fetchMock = mockFetch(200, { following: true });
    globalThis.fetch = fetchMock;
    const result = await followsApi.check("prof-1");
    expect(result.following).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/follows/check/prof-1", expect.any(Object));
  });
});

describe("usersApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("me fetches GET /api/users/me", async () => {
    const user = { id: "u1", display_name: "Test", zos_user_id: null, avatar_url: null, bio: null, location: null, website: null, profile_id: null, created_at: null, updated_at: null };
    const fetchMock = mockFetch(200, user);
    globalThis.fetch = fetchMock;
    const result = await usersApi.me();
    expect(result.id).toBe("u1");
  });

  it("get fetches by userId", async () => {
    const fetchMock = mockFetch(200, { id: "u2" });
    globalThis.fetch = fetchMock;
    await usersApi.get("u2");
    expect(fetchMock).toHaveBeenCalledWith("/api/users/u2", expect.any(Object));
  });

  it("updateMe sends PUT with data", async () => {
    const fetchMock = mockFetch(200, { id: "u1", display_name: "New Name" });
    globalThis.fetch = fetchMock;
    await usersApi.updateMe({ display_name: "New Name" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/me",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ display_name: "New Name" }) }),
    );
  });
});

describe("profilesApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("get fetches profile by id", async () => {
    const fetchMock = mockFetch(200, { id: "prof-1", display_name: "Alice" });
    globalThis.fetch = fetchMock;
    await profilesApi.get("prof-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/profiles/prof-1", expect.any(Object));
  });
});

describe("feedApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("list fetches GET /api/feed without params", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await feedApi.list();
    expect(fetchMock).toHaveBeenCalledWith("/api/feed", expect.any(Object));
  });

  it("list builds query string from filter, limit, offset", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await feedApi.list("following", 10, 20);
    const url = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("filter=following");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=20");
  });

  it("createPost sends POST with data", async () => {
    const fetchMock = mockFetch(200, { id: "post-1" });
    globalThis.fetch = fetchMock;
    await feedApi.createPost({ title: "Hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/posts",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Hello" }) }),
    );
  });

  it("getPost fetches by postId", async () => {
    const fetchMock = mockFetch(200, { id: "post-1" });
    globalThis.fetch = fetchMock;
    await feedApi.getPost("post-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/posts/post-1", expect.any(Object));
  });

  it("getProfilePosts fetches by profileId", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await feedApi.getProfilePosts("prof-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/profiles/prof-1/posts", expect.any(Object));
  });

  it("getComments fetches comments for post", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await feedApi.getComments("post-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/posts/post-1/comments", expect.any(Object));
  });

  it("addComment sends POST with content", async () => {
    const fetchMock = mockFetch(200, { id: "c1", content: "Great!" });
    globalThis.fetch = fetchMock;
    await feedApi.addComment("post-1", "Great!");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/posts/post-1/comments",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "Great!" }) }),
    );
  });

  it("deleteComment sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await feedApi.deleteComment("c1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/comments/c1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("leaderboardApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("get builds query string with period", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await leaderboardApi.get("weekly");
    const url = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("period=weekly");
  });

  it("get appends org_id when provided", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await leaderboardApi.get("monthly", "o1");
    const url = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("period=monthly");
    expect(url).toContain("org_id=o1");
  });
});

describe("platformStatsApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("get fetches GET /api/stats", async () => {
    const stats = { id: "s1", daily_active_users: 100, total_users: 500 };
    const fetchMock = mockFetch(200, stats);
    globalThis.fetch = fetchMock;
    const result = await platformStatsApi.get();
    expect(result).toEqual(stats);
    expect(fetchMock).toHaveBeenCalledWith("/api/stats", expect.any(Object));
  });

  it("returns null when API returns null", async () => {
    const fetchMock = mockFetch(200, null);
    globalThis.fetch = fetchMock;
    const result = await platformStatsApi.get();
    expect(result).toBeNull();
  });
});

describe("usageApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("personal fetches usage with period", async () => {
    const fetchMock = mockFetch(200, { total_tokens: 1000, total_input_tokens: 600, total_output_tokens: 400, total_cost_usd: 0.05 });
    globalThis.fetch = fetchMock;
    await usageApi.personal("weekly");
    expect(fetchMock).toHaveBeenCalledWith("/api/users/me/usage?period=weekly", expect.any(Object));
  });

  it("org fetches org usage", async () => {
    const fetchMock = mockFetch(200, { total_tokens: 5000 });
    globalThis.fetch = fetchMock;
    await usageApi.org("o1", "monthly");
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs/o1/usage?period=monthly", expect.any(Object));
  });

  it("orgMembers fetches member usage", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await usageApi.orgMembers("o1");
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs/o1/usage/members", expect.any(Object));
  });
});

describe("activityApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("getCommitHistory fetches without params", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await activityApi.getCommitHistory({});
    expect(fetchMock).toHaveBeenCalledWith("/api/activity/commits", expect.any(Object));
  });

  it("getCommitHistory builds query from all params", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await activityApi.getCommitHistory({
      user_ids: ["u1", "u2"],
      agent_ids: ["a1"],
      start_date: "2026-01-01",
      end_date: "2026-03-01",
    });
    const url = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("user_ids=u1%2Cu2");
    expect(url).toContain("agent_ids=a1");
    expect(url).toContain("start_date=2026-01-01");
    expect(url).toContain("end_date=2026-03-01");
  });

  it("throws ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "Error", code: "server", details: null });
    await expect(activityApi.getCommitHistory({})).rejects.toThrow(ApiClientError);
  });
});
