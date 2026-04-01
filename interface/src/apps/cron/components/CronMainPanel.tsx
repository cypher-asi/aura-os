import { useParams } from "react-router-dom";
import { Clock, Play, Pause, Trash2 } from "lucide-react";
import { Button, PageEmptyState } from "@cypher-asi/zui";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { useCronStore } from "../stores/cron-store";
import { useCronSidekickStore } from "../stores/cron-sidekick-store";
import { cronApi } from "../../../api/cron";
import type { ReactNode } from "react";
import styles from "./CronMainPanel.module.css";

export function CronMainPanel({ children }: { children?: ReactNode }) {
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const jobs = useCronStore((s) => s.jobs);
  const runs = useCronStore((s) => s.runs);
  const updateJob = useCronStore((s) => s.updateJob);
  const removeJob = useCronStore((s) => s.removeJob);
  const fetchRuns = useCronStore((s) => s.fetchRuns);
  const viewRun = useCronSidekickStore((s) => s.viewRun);

  const job = jobs.find((j) => j.cron_job_id === cronJobId);
  const jobRuns = cronJobId ? runs[cronJobId] ?? [] : [];

  if (!cronJobId || !job) {
    return (
      <ResponsiveMainLane>
        <div className={styles.container}>
          <PageEmptyState icon={<Clock size={32} />} title="Cron Jobs" description="Select a cron job or create one to get started." />
          {children}
        </div>
      </ResponsiveMainLane>
    );
  }

  const handleToggle = async () => {
    try {
      const updated = job.enabled
        ? await cronApi.pauseJob(job.cron_job_id)
        : await cronApi.resumeJob(job.cron_job_id);
      updateJob(updated);
    } catch (e) {
      console.error("Failed to toggle job:", e);
    }
  };

  const handleTrigger = async () => {
    try {
      await cronApi.triggerJob(job.cron_job_id);
      fetchRuns(job.cron_job_id);
    } catch (e) {
      console.error("Failed to trigger job:", e);
    }
  };

  const handleDelete = async () => {
    try {
      await cronApi.deleteJob(job.cron_job_id);
      removeJob(job.cron_job_id);
    } catch (e) {
      console.error("Failed to delete job:", e);
    }
  };

  const statusClass = (status: string) => {
    switch (status) {
      case "completed": return styles.statusCompleted;
      case "failed": return styles.statusFailed;
      case "running": return styles.statusRunning;
      default: return styles.statusPending;
    }
  };

  return (
    <ResponsiveMainLane>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.jobTitle}>{job.name}</span>
            <span className={styles.jobSchedule}>{job.schedule}</span>
          </div>
          <div className={styles.headerActions}>
            <span className={job.enabled ? styles.enabledBadge : styles.disabledBadge}>
              {job.enabled ? "Active" : "Paused"}
            </span>
            <Button variant="ghost" size="sm" iconOnly icon={<Play size={14} />} title="Trigger now" onClick={handleTrigger} />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={job.enabled ? <Pause size={14} /> : <Play size={14} />}
              title={job.enabled ? "Pause" : "Resume"}
              onClick={handleToggle}
            />
            <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} title="Delete" onClick={handleDelete} />
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Details</div>
            <div className={styles.metaGrid}>
              <span className={styles.metaLabel}>Description</span>
              <span>{job.description || "—"}</span>
              <span className={styles.metaLabel}>Last Run</span>
              <span>{job.last_run_at ? new Date(job.last_run_at).toLocaleString() : "Never"}</span>
              <span className={styles.metaLabel}>Next Run</span>
              <span>{job.next_run_at ? new Date(job.next_run_at).toLocaleString() : "—"}</span>
              <span className={styles.metaLabel}>Max Retries</span>
              <span>{job.max_retries}</span>
              <span className={styles.metaLabel}>Timeout</span>
              <span>{job.timeout_seconds}s</span>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Prompt</div>
            <div className={styles.prompt}>{job.prompt}</div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Recent Runs</div>
            {jobRuns.length === 0 && <EmptyState>No runs yet</EmptyState>}
            {jobRuns.map((run) => (
              <button
                key={run.run_id}
                type="button"
                className={styles.runItem}
                onClick={() => viewRun(run)}
              >
                <span className={`${styles.statusDot} ${statusClass(run.status)}`} />
                <span>{run.trigger === "manual" ? "Manual" : "Scheduled"}</span>
                <span>{run.status}</span>
                <span className={styles.runMeta}>
                  {new Date(run.started_at).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
        {children}
      </div>
    </ResponsiveMainLane>
  );
}
