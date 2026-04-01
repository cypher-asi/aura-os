import { useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ButtonPlus, PageEmptyState } from "@cypher-asi/zui";
import { Cpu } from "lucide-react";
import { useCronStore } from "../stores/cron-store";
import { useAgentStore } from "../../agents/stores";
import { useSidebarSearch } from "../../../context/SidebarSearchContext";
import { formatChatTime, describeCronSchedule } from "../../../utils/format";
import { CronJobForm } from "./CronJobForm";
import styles from "./CronJobList.module.css";

export function CronJobList() {
  const jobs = useCronStore((s) => s.jobs);
  const loading = useCronStore((s) => s.loading);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const navigate = useNavigate();
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const [showForm, setShowForm] = useState(false);
  const { query: searchQuery, setAction } = useSidebarSearch();

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    setAction(
      "cron",
      <ButtonPlus onClick={() => setShowForm(true)} size="sm" title="New Cron Job" />,
    );
    return () => setAction("cron", null);
  }, [setAction]);

  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.agent_id, a.name);
    return map;
  }, [agents]);

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
          <PageEmptyState icon={<Cpu size={32} />} title="No cron jobs yet" description="Create a scheduled job to automate tasks on a cron schedule." />
        )}
        {filteredJobs.map((job) => {
          const isSelected = job.cron_job_id === cronJobId;
          const agentName = job.agent_id ? agentMap.get(job.agent_id) : null;
          return (
            <button
              key={job.cron_job_id}
              type="button"
              className={`${styles.row} ${isSelected ? styles.selected : ""}`}
              onClick={() => navigate(`/cron/${job.cron_job_id}`)}
            >
              <span className={styles.statusIcon}>
                <Cpu size={18} />
              </span>
              <span className={styles.body}>
                <span className={styles.top}>
                  <span className={styles.name}>
                    <span className={`${styles.dot} ${job.enabled ? styles.dotActive : styles.dotPaused}`} />
                    {job.name}
                    {agentName && <span className={styles.agentBadge}>{agentName}</span>}
                  </span>
                  {job.next_run_at && <span className={styles.time}>{formatChatTime(job.next_run_at)}</span>}
                </span>
                <span className={styles.preview}>{describeCronSchedule(job.schedule)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {showForm && <CronJobForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
