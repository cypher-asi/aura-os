import { apiFetch } from "./core";
import type { MarketplaceAgent } from "../apps/marketplace/marketplace-types";
import type { MarketplaceTrendingSort } from "../apps/marketplace/marketplace-trending";

/** Query parameters accepted by `GET /api/marketplace/agents`. */
export interface ListMarketplaceAgentsParams {
  sort?: MarketplaceTrendingSort;
  /** Expertise slug to filter by. Empty / undefined = no filter. */
  expertise?: string | null;
  /** Max number of agents to return. Server caps this at 100. */
  limit?: number;
  /** Number of agents to skip, for pagination. */
  offset?: number;
}

/**
 * Response shape returned by `GET /api/marketplace/agents`. Mirrors the Rust
 * `ListMarketplaceAgentsResponse` DTO in `apps/aura-os-server/src/dto.rs`.
 */
export interface ListMarketplaceAgentsResponse {
  agents: MarketplaceAgent[];
  /** Total number of agents that match the filter, pre-pagination. */
  total: number;
}

function buildListQuery(params: ListMarketplaceAgentsParams | undefined): string {
  if (!params) return "";
  const query = new URLSearchParams();
  if (params.sort) query.set("sort", params.sort);
  if (params.expertise) query.set("expertise", params.expertise);
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export const marketplaceApi = {
  list: (params?: ListMarketplaceAgentsParams) =>
    apiFetch<ListMarketplaceAgentsResponse>(
      `/api/marketplace/agents${buildListQuery(params)}`,
    ),

  get: (agentId: string) =>
    apiFetch<MarketplaceAgent>(`/api/marketplace/agents/${agentId}`),
};
