import type { RouteObject } from "react-router-dom";
import { NotesIndexRedirect } from "./NotesIndexRedirect";
import { ShellRoutePlaceholder } from "../../components/ShellRoutePlaceholder/ShellRoutePlaceholder";

/**
 * Routes owned by the Notes app.
 *
 * The index paths (`/notes`, `/notes/:projectId`) render `NotesIndexRedirect`,
 * which picks a default note and navigates to its canonical URL. Hosting this
 * redirect as a dedicated route element — instead of running it from an
 * effect inside `NotesMainPanel` — keeps the auto-select logic from firing
 * during outgoing app switches (which previously caused the Notes → Feedback
 * flicker).
 */
export const notesRoutes: RouteObject[] = [
  { path: "notes", element: <NotesIndexRedirect /> },
  { path: "notes/:projectId", element: <NotesIndexRedirect /> },
  {
    path: "notes/:projectId/:notePath",
    element: <ShellRoutePlaceholder title="Notes" />,
  },
];
