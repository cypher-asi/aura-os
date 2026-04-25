import { useMemo } from "react";
import { useQueries, type Query } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DebugRunMetadata, DebugRunsResponse } from "../../shared/api/debug";

/**
 * Batch fetch runs for a set of project ids — typically the currently
 * expanded nodes in the Debug left menu. Using `useQueries` lets us
 * drive N parallel queries from a dynamic list without violating the
 * hooks-in-a-loop rule, and react-query deduplicates each project's
 * query with the single-project `useDebugRuns` hook so opening the
 * list view doesn't re-fetch what the nav already has.
 */
export interface DebugRunsByProject {
  runsByProject: Record<string, DebugRunMetadata[]>;
  loadedProjectIds: ReadonlySet<string>;
}

export function useDebugRunsByProject(
  projectIds: readonly string[],
): DebugRunsByProject {
  const queries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ["debug", "runs", projectId, null],
      queryFn: () => api.debug.listRuns(projectId),
      enabled: Boolean(projectId),
      // Tighten the refetch cadence when this project currently has a
      // run in `running` state so the nav badge/blue dot tracks the
      // active run closely. Idle projects stay at 10 s to avoid
      // needlessly chatty polling across the whole workspace.
      refetchInterval: (query: Query<DebugRunsResponse>) =>
        query.state.data?.runs?.some(
          (run: DebugRunMetadata) => run.status === "running",
        )
          ? 3_000
          : 10_000,
      staleTime: 5_000,
    })),
  });

  return useMemo(() => {
    const runsByProject: Record<string, DebugRunMetadata[]> = {};
    const loaded = new Set<string>();
    projectIds.forEach((projectId, index) => {
      const query = queries[index];
      if (query?.data) {
        runsByProject[projectId] = query.data.runs;
        loaded.add(projectId);
      }
    });
    return { runsByProject, loadedProjectIds: loaded };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- useQueries returns stable references per entry, and projectIds is the driver
  }, [projectIds, queries.map((q) => q.dataUpdatedAt).join("|")]);
}
