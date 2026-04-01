import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useCronStore } from "../stores/cron-store";

export function CronProvider({ children }: { children: ReactNode }) {
  const fetchJobs = useCronStore((s) => s.fetchJobs);
  const fetchRuns = useCronStore((s) => s.fetchRuns);
  const fetchArtifacts = useCronStore((s) => s.fetchArtifacts);
  const { cronJobId } = useParams<{ cronJobId: string }>();

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  useEffect(() => {
    if (cronJobId) {
      fetchRuns(cronJobId);
      fetchArtifacts(cronJobId);
    }
  }, [cronJobId, fetchRuns, fetchArtifacts]);

  return <>{children}</>;
}
