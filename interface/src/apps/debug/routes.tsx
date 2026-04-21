/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

const DebugEmptyView = lazy(() =>
  import("./DebugMainPanel").then((m) => ({ default: m.DebugEmptyView })),
);
const DebugRunListView = lazy(() =>
  import("./DebugRunListView").then((m) => ({ default: m.DebugRunListView })),
);
const DebugRunDetailView = lazy(() =>
  import("./DebugRunDetailView").then((m) => ({
    default: m.DebugRunDetailView,
  })),
);

export const debugRoutes: RouteObject[] = [
  { path: "debug", element: <DebugEmptyView /> },
  { path: "debug/:projectId", element: <DebugRunListView /> },
  {
    path: "debug/:projectId/runs/:runId",
    element: <DebugRunDetailView />,
  },
];
