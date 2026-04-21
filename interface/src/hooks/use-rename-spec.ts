import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSidekickStore } from "../stores/sidekick-store";
import {
  mergeSpecIntoProjectLayout,
  projectQueryKeys,
  type ProjectLayoutBundle,
} from "../queries/project-queries";
import type { ProjectId, Spec } from "../types";

export interface UseRenameSpecResult {
  /**
   * Commit a rename. Returns the updated spec on success, or `null` if the
   * rename was skipped (empty value, unchanged, missing project).
   * On network/server failure the optimistic update is rolled back and the
   * error is re-thrown so callers can surface a toast if desired.
   */
  renameSpec: (spec: Spec, newTitle: string) => Promise<Spec | null>;
}

/**
 * Shared optimistic rename flow for a spec. Mirrors the pattern of
 * `useDeleteSpec`: updates the sidekick store and the react-query project
 * layout cache immediately, then reconciles with the server response (or
 * rolls back on error).
 */
export function useRenameSpec(projectId: ProjectId | undefined): UseRenameSpecResult {
  const queryClient = useQueryClient();

  const renameSpec = useCallback(
    async (spec: Spec, rawTitle: string): Promise<Spec | null> => {
      const newTitle = rawTitle.trim();
      if (!projectId || !newTitle || newTitle === spec.title) {
        return null;
      }

      const optimistic: Spec = { ...spec, title: newTitle };
      const store = useSidekickStore.getState();
      store.pushSpec(optimistic);
      queryClient.setQueryData<ProjectLayoutBundle | undefined>(
        projectQueryKeys.layout(projectId),
        (current) => mergeSpecIntoProjectLayout(current, optimistic),
      );

      try {
        const updated = await api.updateSpec(projectId, spec.spec_id, {
          title: newTitle,
        });
        useSidekickStore.getState().pushSpec(updated);
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => mergeSpecIntoProjectLayout(current, updated),
        );
        return updated;
      } catch (err) {
        console.error("Failed to rename spec", err);
        useSidekickStore.getState().pushSpec(spec);
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => mergeSpecIntoProjectLayout(current, spec),
        );
        throw err;
      }
    },
    [projectId, queryClient],
  );

  return { renameSpec };
}
