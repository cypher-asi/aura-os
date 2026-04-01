import { useState, useEffect } from "react";
import { Modal, Input, Button, Text } from "@cypher-asi/zui";
import { cronApi } from "../../../api/cron";
import { useCronStore } from "../stores/cron-store";
import { useAgentStore } from "../../agents/stores";
import { SchedulePicker } from "./SchedulePicker";
import { TagSelector } from "./TagSelector";
import styles from "./CronJobForm.module.css";

interface Props {
  onClose: () => void;
}

export function CronJobForm({ onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addJob = useCronStore((s) => s.addJob);

  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleSubmit = async () => {
    if (!name.trim() || !agentId) return;
    setSubmitting(true);
    setError(null);
    try {
      const job = await cronApi.createJob({
        name,
        description,
        schedule,
        prompt: prompt.trim() || undefined,
        agent_id: agentId,
        tags: tags.length ? tags : undefined,
      });
      addJob(job);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create cron job";
      setError(msg);
      console.error("Failed to create cron job:", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create Cron Job"
      size="md"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !agentId}
          >
            {submitting ? "Creating..." : "Create Job"}
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
          <label className={styles.label}>Agent <span className={styles.required}>*</span></label>
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
