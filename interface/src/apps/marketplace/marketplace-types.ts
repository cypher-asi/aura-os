import type { Agent, AgentId } from "../../shared/types";

/**
 * Projection of a `network.Agent` augmented with marketplace-only stats
 * (jobs / revenue / reputation) and a resolved creator display name. In
 * Phase 1 the fields are populated from mock data; in Phase 2 they come
 * from `GET /api/marketplace/agents`.
 *
 * Keeps the underlying `Agent` entity intact so the reused
 * `AgentInfoPanel` can render it without branching on marketplace-ness.
 */
export interface MarketplaceAgent {
  agent: Agent;
  description: string;
  jobs: number;
  revenue_usd: number;
  reputation: number;
  creator_display_name: string;
  creator_user_id: string;
  /** Cover image URL for the talent card header; optional. */
  cover_image_url?: string;
  /** When this agent first became discoverable in the marketplace. */
  listed_at: string;
}

export type MarketplaceAgentId = AgentId;
