import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketplaceAgent } from "../marketplace-types";
import type { Agent } from "../../../shared/types";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    marketplace: {
      list: vi.fn(),
      get: vi.fn(),
    },
  },
}));

vi.mock("../../../api/client", () => ({
  api: mockApi,
  ApiClientError: class ApiClientError extends Error {
    status: number;
    body: { error: string; code: string; details: string | null };
    constructor(
      status: number,
      body: { error: string; code: string; details: string | null },
    ) {
      super(body.error);
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock("../../../shared/api/core", async () => {
  const mod = await import("../../../api/client");
  return { ApiClientError: mod.ApiClientError };
});

import { applyMarketplaceFilters, useMarketplaceStore } from "./marketplace-store";

function makeAgent(overrides: Partial<Agent> & { agent_id: string; name: string }): Agent {
  return {
    agent_id: overrides.agent_id,
    user_id: overrides.user_id ?? "user-1",
    org_id: null,
    name: overrides.name,
    role: overrides.role ?? "",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "remote",
    adapter_type: "aura_harness",
    environment: "swarm_microvm",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    vm_id: null,
    tags: [],
    is_pinned: false,
    listing_status: "hireable",
    expertise: overrides.expertise ?? [],
    jobs: 0,
    revenue_usd: 0,
    reputation: 0,
    created_at: "2026-04-01T09:00:00Z",
    updated_at: "2026-04-14T09:00:00Z",
  };
}

function makeMarketplaceAgent(
  id: string,
  name: string,
  expertise: string[],
  stats: { completed_tasks: number; revenue_usd: number; reputation: number; listed_at: string },
): MarketplaceAgent {
  return {
    agent: makeAgent({ agent_id: id, name, expertise }),
    description: `${name} description`,
    completed_tasks: stats.completed_tasks,
    revenue_usd: stats.revenue_usd,
    reputation: stats.reputation,
    creator_display_name: `${name} creator`,
    creator_user_id: `user-${id}`,
    listed_at: stats.listed_at,
  };
}

const SAMPLE: MarketplaceAgent[] = [
  makeMarketplaceAgent("atlas", "Atlas", ["coding", "devops"], {
    completed_tasks: 142,
    revenue_usd: 48_200,
    reputation: 4.92,
    listed_at: "2026-03-02T00:00:00Z",
  }),
  makeMarketplaceAgent("nyx", "Nyx", ["cyber-security", "research"], {
    completed_tasks: 57,
    revenue_usd: 31_750,
    reputation: 4.88,
    listed_at: "2026-02-11T00:00:00Z",
  }),
  makeMarketplaceAgent("lumen", "Lumen", ["ui-ux", "design", "product-management"], {
    completed_tasks: 88,
    revenue_usd: 22_400,
    reputation: 4.81,
    listed_at: "2026-03-20T00:00:00Z",
  }),
  makeMarketplaceAgent("corpus", "Corpus", ["research", "writing"], {
    completed_tasks: 63,
    revenue_usd: 9_450,
    reputation: 4.7,
    listed_at: "2026-04-01T00:00:00Z",
  }),
];

describe("applyMarketplaceFilters", () => {
  it("sorts by completed tasks descending for the default trending sort", () => {
    const sorted = applyMarketplaceFilters(SAMPLE, "trending", null);
    const taskCounts = sorted.map((a) => a.completed_tasks);
    expect(taskCounts).toEqual([...taskCounts].sort((a, b) => b - a));
    expect(sorted[0].agent.name).toBe("Atlas");
  });

  it("sorts by revenue descending when 'revenue' is selected", () => {
    const sorted = applyMarketplaceFilters(SAMPLE, "revenue", null);
    expect(sorted[0].agent.name).toBe("Atlas");
    expect(sorted[0].revenue_usd).toBeGreaterThan(sorted[1].revenue_usd);
  });

  it("sorts by reputation descending when 'reputation' is selected", () => {
    const sorted = applyMarketplaceFilters(SAMPLE, "reputation", null);
    expect(sorted[0].reputation).toBeGreaterThanOrEqual(sorted[1].reputation);
  });

  it("sorts by listed_at descending when 'latest' is selected", () => {
    const sorted = applyMarketplaceFilters(SAMPLE, "latest", null);
    const dates = sorted.map((a) => a.listed_at);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("filters to agents matching the selected expertise slug via the typed field", () => {
    const filtered = applyMarketplaceFilters(SAMPLE, "trending", "cyber-security");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((a) => a.agent.expertise?.includes("cyber-security"))).toBe(true);
  });

  it("returns an empty list when no agents match the expertise filter", () => {
    const filtered = applyMarketplaceFilters(SAMPLE, "trending", "translation");
    expect(filtered).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const snapshot = [...SAMPLE];
    applyMarketplaceFilters(SAMPLE, "revenue", null);
    expect(SAMPLE).toEqual(snapshot);
  });
});

describe("useMarketplaceStore.refresh", () => {
  beforeEach(() => {
    useMarketplaceStore.setState({
      agents: [],
      loading: false,
      error: null,
      inflight: null,
      sort: "trending",
      expertiseFilter: null,
      selectedAgentId: null,
    });
    vi.clearAllMocks();
  });

  it("populates the roster from the API and clears loading/error", async () => {
    const sample = SAMPLE.slice(0, 2);
    mockApi.marketplace.list.mockResolvedValueOnce({
      agents: sample,
      total: sample.length,
    });

    await useMarketplaceStore.getState().refresh();

    expect(mockApi.marketplace.list).toHaveBeenCalledWith({
      sort: "trending",
      expertise: undefined,
    });
    const state = useMarketplaceStore.getState();
    expect(state.agents).toHaveLength(2);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("forwards the current sort and expertise filter as query params", async () => {
    useMarketplaceStore.setState({ sort: "reputation", expertiseFilter: "coding" });
    mockApi.marketplace.list.mockResolvedValueOnce({ agents: [], total: 0 });

    await useMarketplaceStore.getState().refresh();

    expect(mockApi.marketplace.list).toHaveBeenCalledWith({
      sort: "reputation",
      expertise: "coding",
    });
  });

  it("records a message on failure and stops loading", async () => {
    mockApi.marketplace.list.mockRejectedValueOnce(new Error("network down"));

    await useMarketplaceStore.getState().refresh();

    const state = useMarketplaceStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe("network down");
    expect(state.agents).toEqual([]);
  });

  it("short-circuits when a refresh is already in flight", async () => {
    // Simulate an outstanding request by parking a never-resolving promise on
    // the dedupe field. `loading` is *not* used for dedupe anymore (it doubles
    // as the spinner flag), so seeding it would not block a second refresh.
    const pending = new Promise<void>(() => {});
    useMarketplaceStore.setState({ inflight: pending });

    await Promise.race([
      useMarketplaceStore.getState().refresh(),
      new Promise((resolve) => setTimeout(resolve, 0)),
    ]);

    expect(mockApi.marketplace.list).not.toHaveBeenCalled();
  });

  it("fires the request from the default initial state where loading is true", async () => {
    // Regression for the bug where refresh() short-circuited on the initial
    // `loading: true` and the marketplace was stuck on "Loading marketplace…".
    useMarketplaceStore.setState({
      agents: [],
      loading: true,
      error: null,
      inflight: null,
    });
    mockApi.marketplace.list.mockResolvedValueOnce({
      agents: SAMPLE.slice(0, 1),
      total: 1,
    });

    await useMarketplaceStore.getState().refresh();

    expect(mockApi.marketplace.list).toHaveBeenCalledTimes(1);
    const state = useMarketplaceStore.getState();
    expect(state.loading).toBe(false);
    expect(state.inflight).toBeNull();
    expect(state.agents).toHaveLength(1);
  });
});
