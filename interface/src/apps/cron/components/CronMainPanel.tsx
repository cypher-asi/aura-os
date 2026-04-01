import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Cpu, Play, Pause, Trash2, Pencil, Save, X } from "lucide-react";
import { Button, PageEmptyState } from "@cypher-asi/zui";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { useCronStore } from "../stores/cron-store";
import { useCronSidekickStore } from "../stores/cron-sidekick-store";
import { useAgentStore } from "../../agents/stores";
import { cronApi } from "../../../api/cron";
import { SchedulePicker } from "./SchedulePicker";
import { TagSelector } from "./TagSelector";
import type { ReactNode } from "react";
import { describeCronSchedule } from "../../../utils/format";
import type { CronJob } from "../../../types";
import styles from "./CronMainPanel.module.css";

interface EditState {
  name: string;
  description: string;
  schedule: string;
  prompt: string;
  agent_id: string;
  tags: string[];
}

function editStateFromJob(job: CronJob): EditState {
  return {
    name: job.name,
    description: job.description,
    schedule: job.schedule,
    prompt: job.prompt,
    agent_id: job.agent_id ?? "",
    tags: job.tags ?? [],
  };
}

export function CronMainPanel({ children }: { children?: ReactNode }) {
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const jobs = useCronStore((s) => s.jobs);
  const runs = useCronStore((s) => s.runs);
  const updateJob = useCronStore((s) => s.updateJob);
  const removeJob = useCronStore((s) => s.removeJob);
  const fetchRuns = useCronStore((s) => s.fetchRuns);
  const viewRun = useCronSidekickStore((s) => s.viewRun);

  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFields, setEditFields] = useState<EditState | null>(null);

  const job = jobs.find((j) => j.cron_job_id === cronJobId);
  const jobRuns = cronJobId ? runs[cronJobId] ?? [] : [];

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    setEditing(false);
    setEditFields(null);
  }, [cronJobId]);

  const startEditing = useCallback(() => {
    if (!job) return;
    setEditFields(editStateFromJob(job));
    setEditing(true);
  }, [job]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditFields(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!job || !editFields) return;
    setSaving(true);
    try {
      const updated = await cronApi.updateJob(job.cron_job_id, {
        name: editFields.name,
        description: editFields.description,
        schedule: editFields.schedule,
        prompt: editFields.prompt,
        agent_id: editFields.agent_id || undefined,
        tags: editFields.tags,
      });
      updateJob(updated);
      setEditing(false);
      setEditFields(null);
    } catch (e) {
      console.error("Failed to update job:", e);
    } finally {
      setSaving(false);
    }
  }, [job, editFields, updateJob]);

  if (!cronJobId || !job) {
    return (
      <ResponsiveMainLane>
        <div className={styles.container}>
          <PageEmptyState icon={<Cpu size={32} />} title="Cron Jobs" description="Select a cron job or create one to get started." />
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

  const agentName = job.agent_id
    ? agents.find((a) => a.agent_id === job.agent_id)?.name ?? null
    : null;

  const patch = <K extends keyof EditState>(field: K, value: EditState[K]) =>
    setEditFields((prev) => (prev ? { ...prev, [field]: value } : prev));

  return (
    <ResponsiveMainLane>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {editing ? (
              <input
                className={styles.editTitleInput}
                value={editFields?.name ?? ""}
                onChange={(e) => patch("name", e.target.value)}
              />
            ) : (
              <span className={styles.jobTitle}>{job.name}</span>
            )}
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
            {editing ? (
              <>
                <Button variant="ghost" size="sm" iconOnly icon={<X size={14} />} title="Cancel" onClick={cancelEditing} disabled={saving} />
                <Button variant="primary" size="sm" iconOnly icon={<Save size={14} />} title="Save" onClick={handleSave} disabled={saving} />
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} title="Edit" onClick={startEditing} />
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
              </>
            )}
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Details</div>
            <div className={styles.metaGrid}>
              <span className={styles.metaLabel}>Description</span>
              {editing ? (
                <input
                  className={styles.editInput}
                  value={editFields?.description ?? ""}
                  onChange={(e) => patch("description", e.target.value)}
                  placeholder="Optional description"
                />
              ) : (
                <span>{job.description || "—"}</span>
              )}

              <span className={styles.metaLabel}>Agent</span>
              {editing ? (
                <select
                  className={styles.editSelect}
                  value={editFields?.agent_id ?? ""}
                  onChange={(e) => patch("agent_id", e.target.value)}
                >
                  <option value="">Select an agent...</option>
                  {agents.map((a) => (
                    <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
                  ))}
                </select>
              ) : (
                <span>{agentName ?? "—"}</span>
              )}

              <span className={styles.metaLabel}>Tags</span>
              {editing ? (
                <TagSelector value={editFields?.tags ?? []} onChange={(v) => patch("tags", v)} />
              ) : (
                <span>{job.tags?.length ? job.tags.join(", ") : "—"}</span>
              )}

              <span className={styles.metaLabel}>Schedule</span>
              {editing ? (
                <SchedulePicker value={editFields?.schedule ?? ""} onChange={(v) => patch("schedule", v)} />
              ) : (
                <span>{describeCronSchedule(job.schedule)}</span>
              )}

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
            {editing ? (
              <textarea
                className={styles.editPrompt}
                value={editFields?.prompt ?? ""}
                onChange={(e) => patch("prompt", e.target.value)}
                placeholder="Instructions for the agent to execute on schedule"
                rows={6}
              />
            ) : (
              <div className={styles.prompt}>
                {job.prompt ? job.prompt : <span className={styles.emptyPrompt}>No prompt configured</span>}
              </div>
            )}
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
        {children}
      </div>
    </ResponsiveMainLane>
  );
}
