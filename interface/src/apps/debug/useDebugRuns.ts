import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DebugRunMetadata } from "../../api/debug";
import type { ProjectId } from "../../shared/types";

export interface DebugRunsData {
  runs: DebugRunMetadata[];
  isLoading: boolean;
  error: unknown;
}

/**
 * Fetches all debug run bundles for a project, newest first. The
 * server already returns runs sorted by `started_at` descending so the
 * component does not need to sort. When `specId` is provided the
 * server-side filter scopes the response to runs whose `spec_ids`
 * include that id.
 */
export function useDebugRuns(
  projectId: ProjectId | undefined,
  specId?: string,
): DebugRunsData {
  const query = useQuery({
    queryKey: ["debug", "runs", projectId, specId ?? null],
    queryFn: () => {
      if (!projectId) throw new Error("projectId is required");
      return api.debug.listRuns(projectId, specId ? { specId } : undefined);
    },
    enabled: Boolean(projectId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  return {
    runs: query.data?.runs ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
