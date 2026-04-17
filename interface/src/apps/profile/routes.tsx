import type { RouteObject } from "react-router-dom";
import { ShellRoutePlaceholder } from "../../components/ShellRoutePlaceholder/ShellRoutePlaceholder";

export const profileRoutes: RouteObject[] = [
  { path: "profile", element: <ShellRoutePlaceholder title="Profile" /> },
];
