import { useState } from "react";
import { Button } from "@cypher-asi/zui";
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
  const addJob = useCronStore((s) => s.addJob);

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) return;
    setSubmitting(true);
    try {
      const job = await cronApi.createJob({ name, description, schedule, prompt });
      addJob(job);
      onClose();
    } catch (e) {
      console.error("Failed to create cron job:", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.title}>Create Cron Job</div>
        <div className={styles.field}>
          <label className={styles.label}>Name</label>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Morning Email Digest"
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Description</label>
          <input
            className={styles.input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Schedule (cron expression)</label>
          <input
            className={styles.input}
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
          <textarea
            className={styles.textarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the CEO do each time this job runs?"
            rows={4}
          />
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !prompt.trim()}
          >
            {submitting ? "Creating..." : "Create Job"}
          </Button>
        </div>
      </div>
    </div>
  );
}
