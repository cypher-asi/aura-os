/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import type { RouteObject } from "react-router-dom";

function EmptyRoute() {
  return null;
}

export const desktopRoutes: RouteObject[] = [
  { path: "desktop", element: <EmptyRoute /> },
];
