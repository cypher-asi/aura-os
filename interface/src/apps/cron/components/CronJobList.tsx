import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { ButtonPlus, Menu, Modal, Button, PageEmptyState } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Cpu, Pencil, Trash2, TextCursorInput } from "lucide-react";
import { useCronStore } from "../stores/cron-store";
import { useAgentStore } from "../../agents/stores";
import { useSidebarSearch } from "../../../context/SidebarSearchContext";
import { formatChatTime, describeCronSchedule } from "../../../utils/format";
import { cronApi } from "../../../api/cron";
import { CronJobForm } from "./CronJobForm";
import type { CronJob } from "../../../types";
import styles from "./CronJobList.module.css";

function buildCronMenuItems(): MenuItem[] {
  return [
    { id: "edit", label: "Edit", icon: <Pencil size={14} /> },
    { id: "rename", label: "Rename", icon: <TextCursorInput size={14} /> },
    { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
  ];
}

interface CtxMenuState {
  x: number;
  y: number;
  job: CronJob;
}

export function CronJobList() {
  const jobs = useCronStore((s) => s.jobs);
  const loading = useCronStore((s) => s.loading);
  const updateJob = useCronStore((s) => s.updateJob);
  const removeJob = useCronStore((s) => s.removeJob);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const navigate = useNavigate();
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const [showForm, setShowForm] = useState(false);
  const { query: searchQuery, setAction } = useSidebarSearch();

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<CronJob | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

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

  const jobMap = useMemo(
    () => new Map(jobs.map((j) => [j.cron_job_id, j])),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    if (!searchQuery) return jobs;
    const q = searchQuery.toLowerCase();
    return jobs.filter((job) => {
      const haystack = `${job.name} ${job.schedule}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [jobs, searchQuery]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("button[id]");
      if (!target) return;
      const job = jobMap.get(target.id);
      if (job) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, job });
      }
    },
    [jobMap],
  );

  const handleMenuAction = useCallback(
    (actionId: string) => {
      if (!ctxMenu) return;
      switch (actionId) {
        case "edit":
          navigate(`/cron/${ctxMenu.job.cron_job_id}?edit=1`);
          break;
        case "rename":
          setRenameTarget(ctxMenu.job);
          setRenameName(ctxMenu.job.name);
          setRenameError(null);
          break;
        case "delete":
          setDeleteTarget(ctxMenu.job);
          setDeleteError(null);
          break;
      }
      setCtxMenu(null);
    },
    [ctxMenu, navigate],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await cronApi.deleteJob(deleteTarget.cron_job_id);
      if (cronJobId === deleteTarget.cron_job_id) {
        navigate("/cron");
      }
      removeJob(deleteTarget.cron_job_id);
      setDeleteTarget(null);
    } catch {
      setDeleteError("Failed to delete cron job.");
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, cronJobId, removeJob, navigate]);

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenameLoading(true);
    setRenameError(null);
    try {
      const updated = await cronApi.updateJob(renameTarget.cron_job_id, { name: renameName.trim() });
      updateJob(updated);
      setRenameTarget(null);
    } catch {
      setRenameError("Failed to rename cron job.");
    } finally {
      setRenameLoading(false);
    }
  }, [renameTarget, renameName, updateJob]);

  return (
    <div className={styles.container}>
      <div className={styles.list} onContextMenu={handleContextMenu}>
        {jobs.length === 0 && !loading && (
          <PageEmptyState icon={<Cpu size={32} />} title="No cron jobs yet" description="Create a scheduled job to automate tasks on a cron schedule." />
        )}
        {filteredJobs.map((job) => {
          const isSelected = job.cron_job_id === cronJobId;
          const agentName = job.agent_id ? agentMap.get(job.agent_id) : null;
          return (
            <button
              key={job.cron_job_id}
              id={job.cron_job_id}
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

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxMenuRef}
            className={styles.contextMenuOverlay}
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <Menu
              items={buildCronMenuItems()}
              onChange={handleMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={200}
              isOpen
            />
          </div>,
          document.body,
        )}

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        title="Delete Cron Job"
        size="sm"
        footer={
          <div className={styles.confirmFooter}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLoading}
              className={styles.dangerButton}
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <div className={styles.confirmMessage}>
          Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
        </div>
        {deleteError && <div className={styles.errorText}>{deleteError}</div>}
      </Modal>

      <Modal
        isOpen={!!renameTarget}
        onClose={() => {
          setRenameTarget(null);
          setRenameError(null);
        }}
        title="Rename Cron Job"
        size="sm"
        footer={
          <div className={styles.confirmFooter}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRenameTarget(null);
                setRenameError(null);
              }}
              disabled={renameLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRename}
              disabled={renameLoading || !renameName.trim()}
            >
              {renameLoading ? "Saving..." : "Save"}
            </Button>
          </div>
        }
      >
        <input
          className={styles.renameInput}
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renameName.trim()) handleRename();
          }}
          autoFocus
        />
        {renameError && <div className={styles.errorText}>{renameError}</div>}
      </Modal>

      {showForm && <CronJobForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
