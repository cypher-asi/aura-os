import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useActiveNoteKey,
  useNotesStore,
} from "../../../stores/notes-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { getLastNote } from "../../../utils/storage";
import type { NotesTreeNode } from "../../../shared/api/notes";

function findFirstNoteRelPath(nodes: NotesTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "note") return node.relPath;
    const found = findFirstNoteRelPath(node.children);
    if (found) return found;
  }
  return null;
}

function treeContainsNote(nodes: NotesTreeNode[], relPath: string): boolean {
  for (const node of nodes) {
    if (node.kind === "note" && node.relPath === relPath) return true;
    if (node.kind === "folder" && treeContainsNote(node.children, relPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Route element mounted at `/notes` and `/notes/:projectId`. Picks a sensible
 * note to display and redirects to its canonical URL:
 *   1. The session-active note from the notes store.
 *   2. The last note persisted in localStorage, if it still exists in the tree.
 *   3. The first note found in any project's loaded tree.
 *
 * Lives here (instead of in `NotesMainPanel`) so the auto-select effect is
 * scoped to the Notes app's own routes. Previously the effect ran from
 * `NotesMainPanel`, which stayed mounted for one render after the user
 * navigated away — allowing it to redirect back into `/notes/...` and cancel
 * the pending route change (the "Notes → Feedback flicker" bug).
 */
export function NotesIndexRedirect() {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string }>();
  const activeKey = useActiveNoteKey();
  const trees = useNotesStore((s) => s.trees);
  const projects = useProjectsListStore((s) => s.projects);

  useEffect(() => {
    if (activeKey?.projectId && activeKey.relPath) {
      navigate(
        `/notes/${activeKey.projectId}/${encodeURIComponent(activeKey.relPath)}`,
        { replace: true },
      );
      return;
    }

    const stored = getLastNote();
    if (stored) {
      const tree = trees[stored.projectId];
      if (tree && !tree.loading && treeContainsNote(tree.nodes, stored.relPath)) {
        navigate(
          `/notes/${stored.projectId}/${encodeURIComponent(stored.relPath)}`,
          { replace: true },
        );
        return;
      }
      if (tree?.loading) return;
    }

    const orderedProjects = params.projectId
      ? [
          ...projects.filter((p) => p.project_id === params.projectId),
          ...projects.filter((p) => p.project_id !== params.projectId),
        ]
      : projects;

    for (const project of orderedProjects) {
      const tree = trees[project.project_id];
      if (!tree || tree.loading) continue;
      const first = findFirstNoteRelPath(tree.nodes);
      if (first) {
        navigate(
          `/notes/${project.project_id}/${encodeURIComponent(first)}`,
          { replace: true },
        );
        return;
      }
    }
  }, [activeKey, trees, projects, params.projectId, navigate]);

  return null;
}
