import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { MarketplaceAgent } from "../marketplace-types";
import {
  DEFAULT_MARKETPLACE_SORT,
  type MarketplaceTrendingSort,
} from "../marketplace-trending";
import { api } from "../../../api/client";
import { ApiClientError } from "../../../shared/api/core";

/**
 * Marketplace UI state. In Phase 2 `refresh()` calls `api.marketplace.list()`
 * and becomes the single source of truth for marketplace-specific state
 * (roster, sort, expertise filter, and the currently previewed agent id).
 *
 * The roster starts empty so consumers render an empty state until the
 * first refresh completes; `loading`/`error` exist so pages can surface a
 * spinner or fallback without threading callback state through the tree.
 */
interface MarketplaceState {
  agents: MarketplaceAgent[];
  loading: boolean;
  error: string | null;
  // In-flight refresh promise. Used to dedupe concurrent `refresh()` calls
  // without conflating it with `loading` (which doubles as the spinner flag
  // and is initialised `true` to avoid an empty-state flash on first mount).
  inflight: Promise<void> | null;

  sort: MarketplaceTrendingSort;
  expertiseFilter: string | null;
  selectedAgentId: string | null;

  refresh: () => Promise<void>;
  setSort: (sort: MarketplaceTrendingSort) => void;
  setExpertiseFilter: (slug: string | null) => void;
  setSelectedAgentId: (agentId: string | null) => void;
}

export const useMarketplaceStore = create<MarketplaceState>()((set, get) => ({
  agents: [],
  // Start loading: the main panel always triggers a refresh on mount, and this
  // prevents a one-frame flash of the "no hireable agents" empty state before
  // the first request resolves.
  loading: true,
  error: null,
  inflight: null,

  sort: DEFAULT_MARKETPLACE_SORT,
  expertiseFilter: null,
  selectedAgentId: null,

  refresh: () => {
    const existing = get().inflight;
    if (existing) return existing;

    set({ loading: true, error: null });
    const p = (async () => {
      try {
        const { sort, expertiseFilter } = get();
        const response = await api.marketplace.list({
          sort,
          expertise: expertiseFilter ?? undefined,
        });
        set({ agents: response.agents, loading: false, error: null });
      } catch (err) {
        const message =
          err instanceof ApiClientError
            ? err.body.error || err.message
            : err instanceof Error
              ? err.message
              : "Failed to load marketplace";
        set({ loading: false, error: message });
      } finally {
        set({ inflight: null });
      }
    })();
    set({ inflight: p });
    return p;
  },

  setSort: (sort) => set({ sort }),
  setExpertiseFilter: (expertiseFilter) => set({ expertiseFilter }),
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
}));

/**
 * Apply the current sort + expertise filter to a roster. Exported standalone
 * so tests can exercise the sort/filter logic without mounting the store.
 *
 * Note: the server already sorts and filters (see
 * `apps/aura-os-server/src/handlers/marketplace.rs`); this helper stays so
 * local/offline renders and tests can re-sort a roster without a network
 * round-trip.
 */
export function applyMarketplaceFilters(
  agents: ReadonlyArray<MarketplaceAgent>,
  sort: MarketplaceTrendingSort,
  expertiseFilter: string | null,
): MarketplaceAgent[] {
  const filtered = expertiseFilter
    ? agents.filter((a) => a.agent.expertise?.includes(expertiseFilter) ?? false)
    : agents.slice();

  switch (sort) {
    case "latest":
      return filtered.sort((a, b) => b.listed_at.localeCompare(a.listed_at));
    case "revenue":
      return filtered.sort((a, b) => b.revenue_usd - a.revenue_usd);
    case "reputation":
      return filtered.sort((a, b) => b.reputation - a.reputation);
    case "trending":
    default:
      return filtered.sort((a, b) => b.jobs - a.jobs);
  }
}

export function useMarketplaceFilters(): {
  sort: MarketplaceTrendingSort;
  expertiseFilter: string | null;
  setSort: (sort: MarketplaceTrendingSort) => void;
  setExpertiseFilter: (slug: string | null) => void;
} {
  return useMarketplaceStore(
    useShallow((s) => ({
      sort: s.sort,
      expertiseFilter: s.expertiseFilter,
      setSort: s.setSort,
      setExpertiseFilter: s.setExpertiseFilter,
    })),
  );
}

export function useFilteredMarketplaceAgents(): MarketplaceAgent[] {
  return useMarketplaceStore(
    useShallow((s) => applyMarketplaceFilters(s.agents, s.sort, s.expertiseFilter)),
  );
}

export function useMarketplaceAgentById(
  agentId: string | null | undefined,
): MarketplaceAgent | null {
  return useMarketplaceStore(
    useShallow((s) =>
      agentId ? s.agents.find((a) => a.agent.agent_id === agentId) ?? null : null,
    ),
  );
}
