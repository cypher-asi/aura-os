/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

const IntegrationsEmptyView = lazy(() =>
  import("./IntegrationDetailView").then((m) => ({ default: m.IntegrationsEmptyView })),
);
const IntegrationDetailView = lazy(() =>
  import("./IntegrationDetailView").then((m) => ({ default: m.IntegrationDetailView })),
);

export const integrationsRoutes: RouteObject[] = [
  { path: "integrations", element: <IntegrationsEmptyView /> },
  { path: "integrations/:provider", element: <IntegrationDetailView /> },
];
