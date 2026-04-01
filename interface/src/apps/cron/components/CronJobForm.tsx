import { useState } from "react";
import { Modal, Input, Textarea, Button, Text } from "@cypher-asi/zui";
import { cronApi } from "../../../api/cron";
import { useCronStore } from "../stores/cron-store";
import styles from "./CronJobForm.module.css";

interface Props {
  onClose: () => void;
}

export function CronJobForm({ onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addJob = useCronStore((s) => s.addJob);

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const job = await cronApi.createJob({ name, description, schedule, prompt });
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
            disabled={submitting || !name.trim() || !prompt.trim()}
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
          <label className={styles.label}>Schedule (cron expression)</label>
          <Input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * *"
          />
          <span className={styles.hint}>
            Examples: "0 9 * * *" (daily 9am), "0 */2 * * *" (every 2h), "0 9 * * 1" (Mondays 9am)
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Prompt (instruction for the CEO)</label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the CEO do each time this job runs?"
            rows={4}
          />
        </div>
        {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
      </div>
    </Modal>
  );
}
