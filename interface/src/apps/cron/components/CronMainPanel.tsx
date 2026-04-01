import { useParams } from "react-router-dom";
import { Cpu } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { useCronStore } from "../stores/cron-store";
import { describeCronSchedule } from "../../../utils/format";
import type { ReactNode } from "react";
import styles from "./CronMainPanel.module.css";

export function CronMainPanel({ children }: { children?: ReactNode }) {
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const jobs = useCronStore((s) => s.jobs);
  const job = jobs.find((j) => j.cron_job_id === cronJobId);

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

  return (
    <ResponsiveMainLane>
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
          <span className={job.enabled ? styles.enabledBadge : styles.disabledBadge}>
            {job.enabled ? "Active" : "Paused"}
          </span>
        </div>
        <div className={styles.body}>
          <div className={styles.prompt}>
            {job.prompt ? job.prompt : <span className={styles.emptyPrompt}>No prompt configured</span>}
          </div>
        </div>
        {children}
      </div>
    </ResponsiveMainLane>
  );
}
