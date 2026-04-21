import type { ProjectId } from "../types";
import { apiFetch, apiFetchText } from "./core";
import { resolveApiUrl } from "../lib/host-config";
import { authHeaders } from "../lib/auth-token";

/**
 * Channels inside a debug run bundle. Matches the server enum in
 * `apps/aura-os-server/src/handlers/debug_runs.rs`. String-literal
 * union per `rules-typescript` (no TS enums).
 */
export type DebugChannel =
  | "events"
  | "llm_calls"
  | "iterations"
  | "blockers"
  | "retries";

export type DebugRunStatus = "running" | "completed" | "failed" | "interrupted";

export interface DebugRunCounters {
  events_total: number;
  llm_calls: number;
  iterations: number;
  blockers: number;
  retries: number;
  tool_calls: number;
  task_completed: number;
  task_failed: number;
  input_tokens: number;
  output_tokens: number;
}

export interface DebugRunTask {
  task_id: string;
  started_at: string | null;
  ended_at: string | null;
  status: string | null;
}

export interface DebugRunMetadata {
  run_id: string;
  project_id: ProjectId;
  agent_instance_id: string;
  started_at: string;
  ended_at: string | null;
  status: DebugRunStatus;
  tasks: DebugRunTask[];
  counters: DebugRunCounters;
}

export interface DebugProjectSummary {
  project_id: ProjectId;
  run_count: number;
  latest_run: DebugRunMetadata | null;
}

export interface DebugProjectsResponse {
  projects: DebugProjectSummary[];
}

export interface DebugRunsResponse {
  runs: DebugRunMetadata[];
}

export interface DebugRunSummaryResponse {
  run_id: string;
  markdown: string;
}

export const debugApi = {
  listProjects: () =>
    apiFetch<DebugProjectsResponse>("/api/debug/projects"),
  listRuns: (projectId: ProjectId) =>
    apiFetch<DebugRunsResponse>(`/api/debug/projects/${projectId}/runs`),
  getRunMetadata: (projectId: ProjectId, runId: string) =>
    apiFetch<DebugRunMetadata>(
      `/api/debug/projects/${projectId}/runs/${runId}`,
    ),
  getRunSummary: (projectId: ProjectId, runId: string) =>
    apiFetch<DebugRunSummaryResponse>(
      `/api/debug/projects/${projectId}/runs/${runId}/summary`,
    ),
  getRunLogs: (
    projectId: ProjectId,
    runId: string,
    options?: { channel?: DebugChannel; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (options?.channel) params.set("channel", options.channel);
    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetchText(
      `/api/debug/projects/${projectId}/runs/${runId}/logs${query}`,
    );
  },
  /**
   * Direct link to the zip export. Returns a URL the browser can use
   * for a download anchor. Auth is handled via existing bearer flow
   * when the browser fetches it.
   */
  exportRunUrl: (projectId: ProjectId, runId: string): string =>
    resolveApiUrl(
      `/api/debug/projects/${projectId}/runs/${runId}/export`,
    ),
  /**
   * Stream the zip as a Blob so components can trigger a `download`
   * anchor without relying on a redirect page. Preserves the bearer
   * auth header the CLI export relies on.
   */
  exportRunBlob: async (
    projectId: ProjectId,
    runId: string,
  ): Promise<Blob> => {
    const res = await fetch(
      resolveApiUrl(
        `/api/debug/projects/${projectId}/runs/${runId}/export`,
      ),
      { headers: { ...authHeaders() } },
    );
    if (!res.ok) {
      throw new Error(`export failed: ${res.status} ${res.statusText}`);
    }
    return res.blob();
  },
};
