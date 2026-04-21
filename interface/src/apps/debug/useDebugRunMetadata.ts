import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DebugRunMetadata } from "../../api/debug";
import type { ProjectId } from "../../types";

interface Result {
  metadata: DebugRunMetadata | undefined;
  isLoading: boolean;
  error: unknown;
  isRunning: boolean;
}

export function useDebugRunMetadata(
  projectId: ProjectId | undefined,
  runId: string | undefined,
): Result {
  const query = useQuery({
    queryKey: ["debug", "run-metadata", projectId, runId],
    queryFn: () => {
      if (!projectId || !runId)
        throw new Error("projectId and runId are required");
      return api.debug.getRunMetadata(projectId, runId);
    },
    enabled: Boolean(projectId && runId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 2_000 : false,
    staleTime: 5_000,
  });

  return {
    metadata: query.data,
    isLoading: query.isLoading,
    error: query.error,
    isRunning: query.data?.status === "running",
  };
}
