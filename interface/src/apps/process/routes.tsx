import type { RouteObject } from "react-router-dom";
import { ProcessIndexRedirect } from "./ProcessIndexRedirect";
import { ShellRoutePlaceholder } from "../../components/ShellRoutePlaceholder/ShellRoutePlaceholder";

export const processRoutes: RouteObject[] = [
  { path: "process", element: <ProcessIndexRedirect /> },
  { path: "process/:processId", element: <ShellRoutePlaceholder title="Process" /> },
];
