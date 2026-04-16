import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useProjectActions } from "../../stores/project-action-store";
import { useStreamStore } from "../../hooks/stream/store";
import type { ProjectStatsData } from "../../api/projects";

interface StatsDashboardData {
  stats: ProjectStatsData | null;
  loading: boolean;
}

const EMPTY_PROJECT_STATS: ProjectStatsData = {
  total_tasks: 0,
  pending_tasks: 0,
  ready_tasks: 0,
  in_progress_tasks: 0,
  blocked_tasks: 0,
  done_tasks: 0,
  failed_tasks: 0,
  completion_percentage: 0,
  total_tokens: 0,
  total_events: 0,
  total_agents: 0,
  total_sessions: 0,
  total_time_seconds: 0,
  lines_changed: 0,
  total_specs: 0,
  contributors: 0,
  estimated_cost_usd: 0,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeProjectStats(stats: Partial<ProjectStatsData>): ProjectStatsData {
  return {
    total_tasks: isFiniteNumber(stats.total_tasks) ? stats.total_tasks : EMPTY_PROJECT_STATS.total_tasks,
    pending_tasks: isFiniteNumber(stats.pending_tasks) ? stats.pending_tasks : EMPTY_PROJECT_STATS.pending_tasks,
    ready_tasks: isFiniteNumber(stats.ready_tasks) ? stats.ready_tasks : EMPTY_PROJECT_STATS.ready_tasks,
    in_progress_tasks: isFiniteNumber(stats.in_progress_tasks) ? stats.in_progress_tasks : EMPTY_PROJECT_STATS.in_progress_tasks,
    blocked_tasks: isFiniteNumber(stats.blocked_tasks) ? stats.blocked_tasks : EMPTY_PROJECT_STATS.blocked_tasks,
    done_tasks: isFiniteNumber(stats.done_tasks) ? stats.done_tasks : EMPTY_PROJECT_STATS.done_tasks,
    failed_tasks: isFiniteNumber(stats.failed_tasks) ? stats.failed_tasks : EMPTY_PROJECT_STATS.failed_tasks,
    completion_percentage: isFiniteNumber(stats.completion_percentage)
      ? stats.completion_percentage
      : EMPTY_PROJECT_STATS.completion_percentage,
    total_tokens: isFiniteNumber(stats.total_tokens) ? stats.total_tokens : EMPTY_PROJECT_STATS.total_tokens,
    total_events: isFiniteNumber(stats.total_events) ? stats.total_events : EMPTY_PROJECT_STATS.total_events,
    total_agents: isFiniteNumber(stats.total_agents) ? stats.total_agents : EMPTY_PROJECT_STATS.total_agents,
    total_sessions: isFiniteNumber(stats.total_sessions) ? stats.total_sessions : EMPTY_PROJECT_STATS.total_sessions,
    total_time_seconds: isFiniteNumber(stats.total_time_seconds)
      ? stats.total_time_seconds
      : EMPTY_PROJECT_STATS.total_time_seconds,
    lines_changed: isFiniteNumber(stats.lines_changed) ? stats.lines_changed : EMPTY_PROJECT_STATS.lines_changed,
    total_specs: isFiniteNumber(stats.total_specs) ? stats.total_specs : EMPTY_PROJECT_STATS.total_specs,
    contributors: isFiniteNumber(stats.contributors) ? stats.contributors : EMPTY_PROJECT_STATS.contributors,
    estimated_cost_usd: isFiniteNumber(stats.estimated_cost_usd)
      ? stats.estimated_cost_usd
      : EMPTY_PROJECT_STATS.estimated_cost_usd,
  };
}

export function useStatsDashboardData(): StatsDashboardData {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id ?? null;
  const [stats, setStats] = useState<ProjectStatsData | null>(null);
  const [loading, setLoading] = useState(() => Boolean(projectId));
  const cancelTokenRef = useRef({ cancelled: false });

  const fetchStats = useCallback(() => {
    cancelTokenRef.current.cancelled = true;
    const token = { cancelled: false };
    cancelTokenRef.current = token;

    if (!projectId) {
      setStats(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void api
      .getProjectStats(projectId)
      .then((nextStats) => {
        if (!token.cancelled) {
          setStats(normalizeProjectStats(nextStats));
        }
      })
      .catch(() => {
        if (!token.cancelled) {
          setStats(null);
        }
      })
      .finally(() => {
        if (!token.cancelled) {
          setLoading(false);
        }
      });
  }, [projectId]);

  useEffect(() => {
    fetchStats();
    return () => {
      cancelTokenRef.current.cancelled = true;
    };
  }, [fetchStats]);

  // Refetch whenever any chat stream transitions from streaming to idle.
  // Tokens/cost are populated on the backend after the LLM turn completes,
  // so tracking the rising edge of "stream just ended" keeps the grid in
  // sync without polling.
  const isAnyStreaming = useStreamStore((state) =>
    Object.values(state.entries).some((entry) => entry.isStreaming),
  );
  const wasStreamingRef = useRef(isAnyStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isAnyStreaming) {
      fetchStats();
    }
    wasStreamingRef.current = isAnyStreaming;
  }, [isAnyStreaming, fetchStats]);

  return { stats, loading };
}
