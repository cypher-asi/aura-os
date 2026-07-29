import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, GitCompare, GitMerge, RotateCcw, ShieldCheck } from "lucide-react";
import { api } from "../../../../api/client";
import type {
  SafeWorkspaceDiff,
  SafeWorkspaceStatus,
} from "../../../../shared/api/agents";
import styles from "./SafeWorkspaceBar.module.css";

interface SafeWorkspaceBarProps {
  projectId: string;
  agentInstanceId: string;
  sessionId: string | null;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  isBusy: boolean;
  isLocal: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Safe workspace request failed";
}

function checkpointLabel(createdAt: string, reason: string): string {
  const date = new Date(createdAt);
  const time = Number.isNaN(date.getTime())
    ? createdAt
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${time} · ${reason}`;
}

export function SafeWorkspaceBar({
  projectId,
  agentInstanceId,
  sessionId,
  enabled,
  onEnabledChange,
  isBusy,
  isLocal,
}: SafeWorkspaceBarProps) {
  const [status, setStatus] = useState<SafeWorkspaceStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState("");
  const [preview, setPreview] = useState<SafeWorkspaceDiff | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"restore" | "apply" | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setStatus(null);
      setSelectedCheckpoint("");
      return;
    }
    try {
      const next = await api.getSafeWorkspaceStatus(
        projectId,
        agentInstanceId,
        sessionId,
      );
      setStatus(next);
      if (next.enabled) onEnabledChange(true);
      setSelectedCheckpoint((current) =>
        next.checkpoints.some((checkpoint) => checkpoint.id === current)
          ? current
          : (next.checkpoints[0]?.id ?? ""),
      );
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [agentInstanceId, onEnabledChange, projectId, sessionId]);

  useEffect(() => {
    if (!isBusy) void refresh();
  }, [isBusy, refresh]);

  const active = status?.enabled === true;
  const armed = enabled && !active;
  const selected = useMemo(
    () => status?.checkpoints.find((checkpoint) => checkpoint.id === selectedCheckpoint),
    [selectedCheckpoint, status?.checkpoints],
  );

  const toggle = () => {
    if (!isLocal || active || isBusy) return;
    setNotice(null);
    setPreview(null);
    setConfirmation(null);
    onEnabledChange(!enabled);
  };

  const loadPreview = async () => {
    if (!sessionId || !selectedCheckpoint) return;
    setPending(true);
    setNotice(null);
    try {
      setPreview(
        await api.getSafeWorkspaceDiff(
          projectId,
          agentInstanceId,
          sessionId,
          selectedCheckpoint,
        ),
      );
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const restore = async () => {
    if (!sessionId || !selectedCheckpoint || isBusy) return;
    setConfirmation(null);
    setPending(true);
    setNotice(null);
    try {
      const result = await api.restoreSafeWorkspaceCheckpoint(
        projectId,
        agentInstanceId,
        sessionId,
        selectedCheckpoint,
      );
      setPreview(null);
      setNotice(
        `Files restored to ${result.restoredTo.slice(0, 8)}. Undo checkpoint ${result.undoCheckpointId.slice(0, 8)} was saved.`,
      );
      await refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const applyToProject = async () => {
    if (!sessionId || isBusy) return;
    setConfirmation(null);
    setPending(true);
    setNotice(null);
    try {
      const result = await api.applySafeWorkspaceToProject(
        projectId,
        agentInstanceId,
        sessionId,
      );
      setNotice(
        result.applied
          ? `Applied to ${result.sourcePath}. ${result.stat || "Changes transferred."}`
          : "The project is already up to date with this safe workspace.",
      );
      await refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={styles.shell} aria-label="Safe workspace controls">
      <div className={styles.summaryRow}>
        <button
          type="button"
          className={`${styles.modeButton} ${enabled ? styles.modeButtonEnabled : ""}`}
          onClick={toggle}
          disabled={!isLocal || active || isBusy}
          aria-pressed={enabled}
          title={
            !isLocal
              ? "Safe workspaces currently require a local Git project"
              : active
                ? "This session is permanently isolated"
                : "Give this session its own Git worktree and automatic checkpoints"
          }
        >
          <ShieldCheck size={15} aria-hidden="true" />
          <span>{active ? "Safe workspace active" : armed ? "Safe workspace armed" : "Safe workspace"}</span>
          <span className={styles.stateDot} aria-hidden="true" />
        </button>

        {active && (
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {status.checkpoints.length} checkpoint{status.checkpoints.length === 1 ? "" : "s"}
            <ChevronDown
              size={14}
              className={expanded ? styles.chevronExpanded : undefined}
              aria-hidden="true"
            />
          </button>
        )}

        {!active && (
          <span className={styles.hint}>
            {armed
              ? "Isolation starts with the next message."
              : "Prevent parallel chats from editing the same files."}
          </span>
        )}
      </div>

      {active && expanded && (
        <div className={styles.details}>
          <div className={styles.pathRow} title={status.workspacePath ?? undefined}>
            <span>Isolated path</span>
            <code>{status.workspacePath}</code>
          </div>
          <div className={styles.rollbackRow}>
            <select
              value={selectedCheckpoint}
              onChange={(event) => {
                setSelectedCheckpoint(event.target.value);
                setPreview(null);
                setConfirmation(null);
              }}
              aria-label="Rollback checkpoint"
            >
              {status.checkpoints.map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>
                  {checkpointLabel(checkpoint.createdAt, checkpoint.reason)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setConfirmation(null);
                void loadPreview();
              }}
              disabled={pending || !selectedCheckpoint}
            >
              <GitCompare size={14} aria-hidden="true" />
              Preview
            </button>
            <button
              type="button"
              className={styles.restoreButton}
              onClick={() => setConfirmation("restore")}
              disabled={pending || isBusy || !selectedCheckpoint}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Restore files
            </button>
            <button
              type="button"
              className={styles.applyButton}
              onClick={() => setConfirmation("apply")}
              disabled={pending || isBusy}
            >
              <GitMerge size={14} aria-hidden="true" />
              Apply to project
            </button>
          </div>
          {preview && (
            <div className={styles.preview}>
              <strong>{preview.stat || "No filesystem changes since this checkpoint."}</strong>
              {preview.diff && <pre>{preview.diff}</pre>}
              {preview.truncated && <span>Preview truncated at 200 KB.</span>}
            </div>
          )}
          {confirmation && (
            <div
              className={styles.confirmation}
              role="alertdialog"
              aria-label={confirmation === "restore" ? "Confirm restore" : "Confirm apply"}
            >
              <p>
                {confirmation === "restore"
                  ? `Restore this safe workspace to checkpoint ${selected?.shortId ?? selectedCheckpoint.slice(0, 8)}? Aura will save an undo checkpoint first.`
                  : "Apply this session's isolated changes to the linked project? Aura will stop if the project has conflicting edits."}
              </p>
              <div className={styles.confirmationActions}>
                <button type="button" onClick={() => setConfirmation(null)} disabled={pending}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={confirmation === "restore" ? styles.restoreButton : styles.applyButton}
                  onClick={() => {
                    if (confirmation === "restore") void restore();
                    else void applyToProject();
                  }}
                  disabled={pending || isBusy}
                >
                  {confirmation === "restore" ? "Restore checkpoint" : "Apply changes"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {notice && <p className={styles.notice}>{notice}</p>}
    </section>
  );
}
