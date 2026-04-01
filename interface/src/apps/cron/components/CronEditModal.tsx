import { useState, useEffect } from "react";
import { Modal, Input, Button, Text } from "@cypher-asi/zui";
import { cronApi } from "../../../api/cron";
import { useCronStore } from "../stores/cron-store";
import { useAgentStore } from "../../agents/stores";
import { SchedulePicker } from "./SchedulePicker";
import { TagSelector } from "./TagSelector";
import type { CronJob } from "../../../types";
import styles from "./CronJobForm.module.css";

interface Props {
  job: CronJob;
  onClose: () => void;
}

export function CronEditModal({ job, onClose }: Props) {
  const [name, setName] = useState(job.name);
  const [description, setDescription] = useState(job.description);
  const [schedule, setSchedule] = useState(job.schedule);
  const [prompt, setPrompt] = useState(job.prompt);
  const [agentId, setAgentId] = useState(job.agent_id ?? "");
  const [tags, setTags] = useState<string[]>(job.tags ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateJob = useCronStore((s) => s.updateJob);

  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await cronApi.updateJob(job.cron_job_id, {
        name,
        description,
        schedule,
        prompt,
        agent_id: agentId || undefined,
        tags,
      });
      updateJob(updated);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update cron job";
      setError(msg);
      console.error("Failed to update cron job:", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit Cron Job"
      size="md"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Saving..." : "Save"}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Morning Email Digest"
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Agent</label>
          <select
            className={styles.select}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Select an agent...</option>
            {agents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Prompt</label>
          <textarea
            className={styles.textarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Instructions for the agent to execute on schedule"
            rows={4}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Tags</label>
          <TagSelector value={tags} onChange={setTags} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Schedule</label>
          <SchedulePicker value={schedule} onChange={setSchedule} />
        </div>
        {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
      </div>
    </Modal>
  );
}
