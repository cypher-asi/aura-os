import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import { useProjectContext } from "../../stores/project-action-store";
import type { ProjectStatsData } from "../../api/projects";

interface StatsDashboardData {
  stats: ProjectStatsData | null;
  loading: boolean;
}

export function useStatsDashboardData(): StatsDashboardData {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id ?? null;
  const [stats, setStats] = useState<ProjectStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(() => {
    if (!projectId) {
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getProjectStats(projectId)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading };
}
