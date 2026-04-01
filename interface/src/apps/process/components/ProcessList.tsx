import { useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ButtonPlus, PageEmptyState } from "@cypher-asi/zui";
import { Workflow } from "lucide-react";
import { useProcessStore } from "../stores/process-store";
import { useSidebarSearch } from "../../../context/SidebarSearchContext";
import { formatChatTime } from "../../../utils/format";
import { ProcessForm } from "./ProcessForm";
import styles from "../../cron/components/CronJobList.module.css";

export function ProcessList() {
  const processes = useProcessStore((s) => s.processes);
  const loading = useProcessStore((s) => s.loading);
  const navigate = useNavigate();
  const { processId } = useParams<{ processId: string }>();
  const [showForm, setShowForm] = useState(false);
  const { query: searchQuery, setAction } = useSidebarSearch();

  useEffect(() => {
    setAction(
      "process",
      <ButtonPlus onClick={() => setShowForm(true)} size="sm" title="New Process" />,
    );
    return () => setAction("process", null);
  }, [setAction]);

  const filtered = useMemo(() => {
    if (!searchQuery) return processes;
    const q = searchQuery.toLowerCase();
    return processes.filter((p) => p.name.toLowerCase().includes(q));
  }, [processes, searchQuery]);

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {processes.length === 0 && !loading && (
          <PageEmptyState
            icon={<Workflow size={32} />}
            title="No processes yet"
            description="Create a process to build automated workflows."
          />
        )}
        {filtered.map((p) => {
          const isSelected = p.process_id === processId;
          return (
            <button
              key={p.process_id}
              id={p.process_id}
              type="button"
              className={`${styles.row} ${isSelected ? styles.selected : ""}`}
              onClick={() => navigate(`/process/${p.process_id}`)}
            >
              <span className={styles.statusIcon}>
                <Workflow size={18} />
              </span>
              <span className={styles.body}>
                <span className={styles.top}>
                  <span className={styles.name}>
                    <span className={`${styles.dot} ${p.enabled ? styles.dotActive : styles.dotPaused}`} />
                    {p.name}
                  </span>
                  {p.updated_at && <span className={styles.time}>{formatChatTime(p.updated_at)}</span>}
                </span>
                <span className={styles.preview}>
                  {p.description || (p.enabled ? "Active" : "Paused")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {showForm && <ProcessForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
