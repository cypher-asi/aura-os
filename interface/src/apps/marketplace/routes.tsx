import type { RouteObject } from "react-router-dom";

/**
 * Routes owned by the Marketplace app. Both entries are no-op elements —
 * `MarketplaceMainPanel` renders the talent grid directly and reads
 * `:agentId` from the route params, so there is no per-route element to
 * swap in. Keeping both paths registered ensures `/marketplace/:agentId`
 * still resolves to the marketplace app when linked externally.
 */
export const marketplaceRoutes: RouteObject[] = [
  { path: "marketplace", element: null },
  { path: "marketplace/:agentId", element: null },
];
