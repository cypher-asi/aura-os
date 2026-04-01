import { useNavigate, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import { useCronStore } from "../stores/cron-store";
import { useState } from "react";
import { CronJobForm } from "./CronJobForm";
import styles from "./CronJobList.module.css";

export function CronJobList() {
  const jobs = useCronStore((s) => s.jobs);
  const loading = useCronStore((s) => s.loading);
  const navigate = useNavigate();
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Cron Jobs</span>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<Plus size={16} />}
          title="Create cron job"
          onClick={() => setShowForm(true)}
        />
      </div>
      <div className={styles.list}>
        {jobs.length === 0 && !loading && (
          <div className={styles.empty}>
            No cron jobs yet. Create one to get started.
          </div>
        )}
        {jobs.map((job) => (
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
