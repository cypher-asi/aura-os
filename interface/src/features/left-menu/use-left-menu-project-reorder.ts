import { useCallback, useMemo } from "react";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { ARCHIVED_ROOT_NODE_ID } from "../../components/ProjectList/project-list-explorer-node";
import type { LeftMenuEntry } from "./types";

export interface LeftMenuRootReorderConfig {
  draggableEntryIds: string[];
  onReorder: (orderedIds: string[]) => void;
}

export interface UseLeftMenuProjectReorderOptions {
  /**
   * When true, drag-to-reorder is disabled (e.g., the app's sidebar search
   * is active and filtered results are displayed).
   */
  searchActive?: boolean;

  /**
   * Map a `LeftMenuEntry.id` for a top-level group back to the project id
   * expected by `saveProjectOrder`. Return `null` for entries that are not
   * actually projects and should be skipped during persistence.
   *
   * Defaults to identity (entry id === project id).
   */
  resolveProjectId?: (entryId: string) => string | null;

  /**
   * Additional root entry ids to exclude from drag-reorder on top of the
   * default exclusions (`ARCHIVED_ROOT_NODE_ID` and `variant === "section"`).
   */
  extraExcludedIds?: ReadonlySet<string>;
}

const EMPTY_EXCLUDED = new Set<string>();

function identity(entryId: string): string {
  return entryId;
}

/**
 * Shared hook that produces the `rootReorder` prop for `LeftMenuTree`, giving
 * every app (Projects, Tasks, Notes, Process) identical drag-to-reorder
 * behavior for top-level project groups. Reorder is persisted globally via
 * `useProjectsListStore.saveProjectOrder`, so dragging in any app updates the
 * shared project order everywhere.
 */
export function useLeftMenuProjectReorder(
  entries: LeftMenuEntry[],
  options?: UseLeftMenuProjectReorderOptions,
): LeftMenuRootReorderConfig | undefined {
  const searchActive = options?.searchActive ?? false;
  const resolveProjectId = options?.resolveProjectId ?? identity;
  const extraExcludedIds = options?.extraExcludedIds ?? EMPTY_EXCLUDED;

  const saveProjectOrder = useProjectsListStore((s) => s.saveProjectOrder);

  const draggableEntryIds = useMemo(() => {
    if (searchActive) {
      return [];
    }
    return entries
      .filter(
        (entry) =>
          entry.kind === "group" &&
          entry.id !== ARCHIVED_ROOT_NODE_ID &&
          entry.variant !== "section" &&
          !extraExcludedIds.has(entry.id) &&
          resolveProjectId(entry.id) !== null,
      )
      .map((entry) => entry.id);
  }, [entries, extraExcludedIds, resolveProjectId, searchActive]);

  const onReorder = useCallback(
    (orderedEntryIds: string[]) => {
      const orderedProjectIds = orderedEntryIds
        .map((entryId) => resolveProjectId(entryId))
        .filter((projectId): projectId is string => projectId !== null);
      saveProjectOrder(orderedProjectIds);
    },
    [resolveProjectId, saveProjectOrder],
  );

  if (draggableEntryIds.length < 2) {
    return undefined;
  }

  return { draggableEntryIds, onReorder };
}
