/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import { lazy } from "react";
import type { RouteObject } from "react-router-dom";
import { AgentIndexRedirect } from "./AgentIndexRedirect";

const AgentChatView = lazy(() =>
  import("../../components/AgentChatView").then((m) => ({ default: m.AgentChatView })),
);

/**
 * Routes owned by the Agents app. Kept as a thin, statically-importable module
 * so `apps/registry.ts` can assemble the full route tree without pulling in
 * the heavy agent panel code — the elements themselves are lazy-loaded.
 */
export const agentsRoutes: RouteObject[] = [
  { path: "agents", element: <AgentIndexRedirect /> },
  { path: "agents/:agentId", element: <AgentChatView /> },
];
