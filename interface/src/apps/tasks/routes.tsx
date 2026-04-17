import type { RouteObject } from "react-router-dom";
import { ShellRoutePlaceholder } from "../../components/ShellRoutePlaceholder/ShellRoutePlaceholder";

/**
 * Routes owned by the Tasks app. The panel (`TasksMainPanel`) renders its
 * own content from URL params — these route elements exist so React Router
 * matches the path and exposes `:projectId` / `:agentInstanceId`.
 */
export const tasksRoutes: RouteObject[] = [
  { path: "tasks", element: <ShellRoutePlaceholder title="Tasks" /> },
  { path: "tasks/:projectId", element: <ShellRoutePlaceholder title="Tasks" /> },
  {
    path: "tasks/:projectId/agents/:agentInstanceId",
    element: <ShellRoutePlaceholder title="Tasks" />,
  },
];
