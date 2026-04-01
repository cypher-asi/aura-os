import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Play, Pause, Trash2, Pencil } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import { Avatar } from "../../../components/Avatar";
import { useCronStore } from "../stores/cron-store";
import { useCronSidekickStore } from "../stores/cron-sidekick-store";
import { useAgentStore } from "../../agents/stores";
import { cronApi } from "../../../api/cron";
import { describeCronSchedule } from "../../../utils/format";
import { EmptyState } from "../../../components/EmptyState";
import { CronEditModal } from "./CronEditModal";
import styles from "./CronInfoTab.module.css";

export function CronInfoTab() {
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const jobs = useCronStore((s) => s.jobs);
  const runs = useCronStore((s) => s.runs);
  const updateJob = useCronStore((s) => s.updateJob);
  const removeJob = useCronStore((s) => s.removeJob);
  const fetchRuns = useCronStore((s) => s.fetchRuns);
  const viewRun = useCronSidekickStore((s) => s.viewRun);
  const agents = useAgentStore((s) => s.agents);

  const [editModalOpen, setEditModalOpen] = useState(false);

  const job = jobs.find((j) => j.cron_job_id === cronJobId);
  const jobRuns = cronJobId ? runs[cronJobId] ?? [] : [];

  const handleToggle = useCallback(async () => {
    if (!job) return;
    try {
      const updated = job.enabled
        ? await cronApi.pauseJob(job.cron_job_id)
        : await cronApi.resumeJob(job.cron_job_id);
      updateJob(updated);
    } catch (e) {
      console.error("Failed to toggle job:", e);
    }
  }, [job, updateJob]);

  const handleTrigger = useCallback(async () => {
    if (!job) return;
    try {
      await cronApi.triggerJob(job.cron_job_id);
      fetchRuns(job.cron_job_id);
    } catch (e) {
      console.error("Failed to trigger job:", e);
    }
  }, [job, fetchRuns]);

  const handleDelete = useCallback(async () => {
    if (!job) return;
    try {
      await cronApi.deleteJob(job.cron_job_id);
      removeJob(job.cron_job_id);
    } catch (e) {
      console.error("Failed to delete job:", e);
    }
  }, [job, removeJob]);

  const statusClass = (status: string) => {
    switch (status) {
      case "completed": return styles.statusCompleted;
      case "failed": return styles.statusFailed;
      case "running": return styles.statusRunning;
      default: return styles.statusPending;
    }
  };

  if (!cronJobId || !job) {
    return <EmptyState>Select a cron job</EmptyState>;
  }

  const agent = job.agent_id
    ? agents.find((a) => a.agent_id === job.agent_id) ?? null
    : null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.jobTitle}>{job.name}</span>
          <div className={styles.headerBadges}>
            <span className={styles.jobSchedule}>{describeCronSchedule(job.schedule)}</span>
            {job.tags?.map((t) => (
              <span key={t} className={styles.tagBadge}>{t}</span>
            ))}
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={job.enabled ? styles.enabledBadge : styles.disabledBadge}>
            {job.enabled ? "Active" : "Paused"}
          </span>
          <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} title="Edit" onClick={() => setEditModalOpen(true)} />
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

            <span className={styles.metaLabel}>Agent</span>
            {agent ? (
              <span className={styles.agentCell}>
                <Avatar
                  avatarUrl={agent.icon ?? undefined}
                  name={agent.name}
                  type="agent"
                  size={18}
                />
                {agent.name}
              </span>
            ) : (
              <span>—</span>
            )}

            <span className={styles.metaLabel}>Tags</span>
            <span>{job.tags?.length ? job.tags.join(", ") : "—"}</span>

            <span className={styles.metaLabel}>Schedule</span>
            <span>{describeCronSchedule(job.schedule)}</span>

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
          <div className={styles.prompt}>
            {job.prompt ? job.prompt : <span className={styles.emptyPrompt}>No prompt configured</span>}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Recent Runs</div>
          {jobRuns.length === 0 && <div className={styles.emptyRuns}>No runs yet</div>}
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

      {editModalOpen && (
        <CronEditModal job={job} onClose={() => setEditModalOpen(false)} />
      )}
    </div>
  );
}
