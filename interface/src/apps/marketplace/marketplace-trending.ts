import type { ReactNode } from "react";
import { Clock, DollarSign, Flame, Star } from "lucide-react";

/**
 * Sort orders shown in the Marketplace sidebar's "Trending" section. In
 * Phase 1 these drive a client-side sort of mock agents; in Phase 2 they
 * become a `sort` query parameter passed to the marketplace API.
 */
export const MARKETPLACE_TRENDING_SORTS = [
  { id: "trending", label: "Trending", icon: Flame },
  { id: "latest", label: "Latest", icon: Clock },
  { id: "revenue", label: "Revenue", icon: DollarSign },
  { id: "reputation", label: "Reputation", icon: Star },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
}>;

export type MarketplaceTrendingSort = (typeof MARKETPLACE_TRENDING_SORTS)[number]["id"];

export const DEFAULT_MARKETPLACE_SORT: MarketplaceTrendingSort = "trending";
