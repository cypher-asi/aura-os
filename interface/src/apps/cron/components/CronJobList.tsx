import { useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ButtonPlus, PageEmptyState } from "@cypher-asi/zui";
import { Clock } from "lucide-react";
import { useCronStore } from "../stores/cron-store";
import { useSidebarSearch } from "../../../context/SidebarSearchContext";
import { CronJobForm } from "./CronJobForm";
import styles from "./CronJobList.module.css";

export function CronJobList() {
  const jobs = useCronStore((s) => s.jobs);
  const loading = useCronStore((s) => s.loading);
  const navigate = useNavigate();
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const [showForm, setShowForm] = useState(false);
  const { query: searchQuery, setAction } = useSidebarSearch();

  useEffect(() => {
    setAction(
      "cron",
      <ButtonPlus onClick={() => setShowForm(true)} size="sm" title="New Cron Job" />,
    );
    return () => setAction("cron", null);
  }, [setAction]);

  const filteredJobs = useMemo(() => {
    if (!searchQuery) return jobs;
    const q = searchQuery.toLowerCase();
    return jobs.filter((job) => {
      const haystack = `${job.name} ${job.schedule}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [jobs, searchQuery]);

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {jobs.length === 0 && !loading && (
          <PageEmptyState icon={<Clock size={32} />} title="No cron jobs yet" description="Create a scheduled job to automate tasks on a cron schedule." />
        )}
        {filteredJobs.map((job) => (
          <button
            key={job.cron_job_id}
            type="button"
            className={styles.jobItem}
            data-selected={job.cron_job_id === cronJobId}
            onClick={() => navigate(`/cron/${job.cron_job_id}`)}
          >
            <span className={styles.jobName}>
              <span
                className={`${styles.dot} ${
                  job.enabled ? styles.dotActive : styles.dotPaused
                }`}
              />
              {job.name}
            </span>
            <span className={styles.jobMeta}>
              <span>{job.schedule}</span>
              {job.next_run_at && (
                <span>Next: {new Date(job.next_run_at).toLocaleString()}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {showForm && <CronJobForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
