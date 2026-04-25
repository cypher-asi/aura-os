import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DebugProjectSummary } from "../../shared/api/debug";

export interface DebugProjectsData {
  projects: DebugProjectSummary[];
  isLoading: boolean;
  error: unknown;
}

/**
 * Fetches the list of projects that have at least one debug run bundle
 * on disk. Thin hook around the `GET /api/debug/projects` endpoint.
 * Polling is intentionally modest because new runs are only created
 * when the dev loop starts.
 */
export function useDebugProjects(): DebugProjectsData {
  const query = useQuery({
    queryKey: ["debug", "projects"],
    queryFn: () => api.debug.listProjects(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  return {
    projects: query.data?.projects ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
