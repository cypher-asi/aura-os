/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import type { RouteObject } from "react-router-dom";
import { AgentChatView } from "./components/AgentChatView";
import { AgentIndexRedirect } from "./AgentIndexRedirect";

/**
 * Routes owned by the Agents app. `AgentChatView` is imported eagerly —
 * the projects app already pulls it into the initial bundle (see
 * `apps/projects/routes.tsx`) so lazy-loading here only added a dynamic
 * import round-trip to the cold-boot critical path without saving any
 * bytes in practice.
 */
export const agentsRoutes: RouteObject[] = [
  { path: "agents", element: <AgentIndexRedirect /> },
  { path: "agents/:agentId", element: <AgentChatView /> },
];
