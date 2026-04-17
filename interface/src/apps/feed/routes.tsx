import type { RouteObject } from "react-router-dom";
import { ShellRoutePlaceholder } from "../../components/ShellRoutePlaceholder/ShellRoutePlaceholder";

export const feedRoutes: RouteObject[] = [
  { path: "feed", element: <ShellRoutePlaceholder title="Feed" /> },
];
