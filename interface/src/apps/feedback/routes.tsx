import type { RouteObject } from "react-router-dom";
import { ShellRoutePlaceholder } from "../../components/ShellRoutePlaceholder/ShellRoutePlaceholder";

export const feedbackRoutes: RouteObject[] = [
  { path: "feedback", element: <ShellRoutePlaceholder title="Feedback" /> },
];
