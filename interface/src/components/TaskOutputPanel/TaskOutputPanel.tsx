import { useRef } from "react";
import { useParams } from "react-router-dom";
import { Text, ModalConfirm } from "@cypher-asi/zui";
import { Trash2, Play, Pause, Square, Loader2, X } from "lucide-react";
import {
  useTaskOutputPanelStore,
  useTasksForProject,
} from "../../stores/task-output-panel-store";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { useAutomationStatus } from "../AutomationBar/useAutomationStatus";
import { useScrollAnchorV2 } from "../../hooks/use-scroll-anchor-v2";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { TerminalPanelBody } from "../TerminalPanelBody";
import { ActiveTaskStream } from "./ActiveTaskStream";
import { CompletedTaskOutput } from "./CompletedTaskOutput";
import styles from "./TaskOutputPanel.module.css";

function AutomationControls({ projectId }: { projectId: string }) {
  const {
    canPlay, canPause, canStop, starting, preparing,
    handleStart, handlePause, handleStop, handleStopConfirm,
    confirmStop, setConfirmStop,
    stopError, clearStopError,
  } = useAutomationStatus(projectId);

  const showStopPause = canPause || canStop;

  return (
    <>
      {!showStopPause && (
        <button
          type="button"
          className={styles.runBtnGroup}
          onClick={handleStart}
          disabled={!canPlay}
          title="Run"
          aria-label="Run automation"
        >
          {starting || preparing
            ? <Loader2 size={11} className={styles.spinner} />
            : <Play size={11} />}
          <span>Run</span>
        </button>
      )}
      {showStopPause && (
        <>
          {canPlay && (
            <button
              type="button"
              className={styles.runBtnGroup}
              onClick={handleStart}
              title="Resume"
              aria-label="Resume automation"
            >
              <Play size={11} />
              <span>Run</span>
            </button>
          )}
          {canPause && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={handlePause}
              title="Pause"
              aria-label="Pause automation"
            >
              <Pause size={11} />
            </button>
          )}
          <button
            type="button"
            className={styles.headerBtn}
            onClick={handleStop}
            disabled={!canStop}
            title="Stop"
            aria-label="Stop automation"
          >
            <Square size={11} />
          </button>
        </>
      )}

      <ModalConfirm
        isOpen={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={handleStopConfirm}
        title="Stop Execution"
        message="Stop autonomous execution? The current task will complete first."
        confirmLabel="Stop"
        cancelLabel="Cancel"
        danger
      />

      {stopError && (
        <ModalConfirm
          isOpen
          onClose={clearStopError}
          onConfirm={clearStopError}
          title="Stop failed"
          message={stopError}
          confirmLabel="Dismiss"
          cancelLabel="Close"
        />
      )}
    </>
  );
}

function TerminalInstanceTabs() {
  const { terminals, activeId, setActiveId, removeTerminal } = useTerminalPanelStore(
    useShallow((s) => ({
      terminals: s.terminals,
      activeId: s.activeId,
      setActiveId: s.setActiveId,
      removeTerminal: s.removeTerminal,
    })),
  );

  if (terminals.length <= 1) return null;

  return (
    <div className={styles.terminalInstanceTabs}>
      {terminals.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className={t.id === activeId ? styles.terminalInstanceTabActive : styles.terminalInstanceTab}
          onClick={() => setActiveId(t.id)}
        >
          {t.title}
          {i > 0 && (
            <span
              className={styles.terminalInstanceTabClose}
              onClick={(e) => { e.stopPropagation(); removeTerminal(t.id); }}
            >
              <X size={9} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function RunSidekickPane() {
  const clearCompleted = useTaskOutputPanelStore((s) => s.clearCompleted);
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const { agentInstanceId } = useParams<{ agentInstanceId?: string }>();
  const projectTasks = useTasksForProject(projectId, agentInstanceId);
  const hasCompleted = projectTasks.some((t) => t.status !== "active");

  const contentRef = useRef<HTMLDivElement>(null);
  const { handleScroll, isAutoFollowing } = useScrollAnchorV2(contentRef, {
    resetKey: `${projectId ?? ""}:${agentInstanceId ?? ""}`,
  });

  return (
    <div className={styles.sidekickPane}>
      <div className={styles.sidekickPaneHeader}>
        <div className={styles.headerActions}>
          {projectId && <AutomationControls projectId={projectId} />}
          {hasCompleted && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={clearCompleted}
              title="Clear completed"
              aria-label="Clear completed task output"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.contentShell}>
        <div
          className={styles.content}
          ref={contentRef}
          onScroll={handleScroll}
        >
          {projectTasks.length === 0 ? (
            <div className={styles.emptyState}>
              <Text size="sm" className={styles.emptyText}>No tasks</Text>
            </div>
          ) : (
            projectTasks.map((entry) =>
              entry.status === "active" ? (
                <ActiveTaskStream
                  key={entry.taskId}
                  taskId={entry.taskId}
                  title={entry.title}
                  scrollRef={contentRef}
                  isAutoFollowing={isAutoFollowing}
                />
              ) : (
                <CompletedTaskOutput
                  key={entry.taskId}
                  taskId={entry.taskId}
                  projectId={entry.projectId}
                  title={entry.title}
                  status={entry.status}
                  failureReason={entry.failureReason}
                />
              ),
            )
          )}
        </div>
        <OverlayScrollbar scrollRef={contentRef} />
      </div>
    </div>
  );
}

export function TerminalSidekickPane() {
  return (
    <div className={styles.terminalContent}>
      <TerminalInstanceTabs />
      <TerminalPanelBody embedded />
    </div>
  );
}
