import { useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Text, ModalConfirm } from "@cypher-asi/zui";
import { Play, Pause, Square, Loader2 } from "lucide-react";
import { useTasksForProject } from "../../stores/task-output-panel-store";
import { useProjectActions } from "../../stores/project-action-store";
import { selectProjectActivity, useLoopActivityStore } from "../../stores/loop-activity-store";
import { useAutomationStatus } from "../AutomationBar/useAutomationStatus";
import { AutomationModelPicker } from "../AutomationBar/AutomationModelPicker";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import {
  canStartWorkspaceAutomation,
  resolveWorkspaceAccess,
} from "../../shared/lib/workspace-access";
import { useScrollAnchorV2 } from "../../shared/hooks/use-scroll-anchor-v2";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { TerminalPanelBody } from "../TerminalPanelBody";
import { TerminalInstanceTabs } from "../TerminalInstanceTabs";
import { ActiveTaskStream } from "./ActiveTaskStream";
import { CompletedTaskOutput } from "./CompletedTaskOutput";
import { PinnedTaskStreamingIndicator } from "./PinnedTaskStreamingIndicator";
import { CookingIndicator } from "../CookingIndicator";
import { StatusBadge } from "../StatusBadge";
import styles from "./TaskOutputPanel.module.css";

function AutomationControls({
  projectId,
  workspaceGateActive,
  workspaceGateTitle,
  startAgentInstanceId,
}: {
  projectId: string;
  workspaceGateActive: boolean;
  workspaceGateTitle: string;
  startAgentInstanceId?: string;
}) {
  const {
    status, canPlay, canPause, canStop, starting, preparing,
    handleStart, handlePause, handleStop, handleStopConfirm,
    confirmStop, setConfirmStop,
    stopError, clearStopError,
  } = useAutomationStatus(projectId, startAgentInstanceId, {
    allowDetachedReattach: !workspaceGateActive,
    detachedReattachAgentInstanceId: startAgentInstanceId,
  });

  const showStopPause = canPause || canStop;
  // The loop is doing work across the same three sub-phases the
  // AutomationBar's PlayLoopGlyph ring lights up for. We accent the
  // Run button in this window so the running state stops reading as
  // the same muted grey as idle.
  const loopWorking =
    status === "starting" || status === "preparing" || status === "active";

  return (
    <>
      {!showStopPause && (
        <button
          type="button"
          className={loopWorking ? `${styles.runBtnGroup} ${styles.runBtnGroupActive}` : styles.runBtnGroup}
          onClick={handleStart}
          disabled={!canPlay || workspaceGateActive}
          title={workspaceGateActive ? workspaceGateTitle : "Run"}
          aria-label="Run automation"
        >
          {starting || preparing
            ? <Loader2 size={14} className={styles.spinner} />
            : <Play size={14} />}
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
              title={workspaceGateActive ? workspaceGateTitle : "Resume"}
              aria-label="Resume automation"
              disabled={workspaceGateActive}
            >
              <Play size={14} />
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
              <Pause size={13} />
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
            <Square size={13} />
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

/**
 * Inline model picker for the Run pane header. Wraps the shared
 * `AutomationModelPicker` so we can lock its trigger while the loop is
 * starting / preparing / active / paused — the model is captured at
 * `startLoop` time, so allowing the user to flip it mid-run would lie
 * about what's actually steering the running loop. Kept as its own
 * component so `useAutomationStatus` only fires when we have a real
 * `projectId` to scope the loop status fetch to.
 *
 * Shares the same `automation-loop-store` slot as the
 * `SidekickHeader`/`AutomationBar` picker, so the two surfaces stay
 * in lockstep and both flow into the next `startLoop` call.
 */
function RunPaneModelPicker({ projectId }: { projectId: string }) {
  const { status } = useAutomationStatus(projectId, undefined, {
    allowDetachedReattach: false,
  });
  const disabled = status !== "idle" && status !== "stopped";
  return (
    <div className={styles.headerModelSlot}>
      <AutomationModelPicker projectId={projectId} disabled={disabled} />
    </div>
  );
}

/**
 * Always-visible run-state badge for the Run pane header. The Run /
 * Pause / Stop buttons alone can't communicate "the loop is alive":
 * in the `active` state the "Run" label disappears entirely, leaving
 * only two muted icons. This pulsing, color-coded badge (shared with
 * the `AutomationBar` via `StatusBadge`) makes the running / preparing
 * / paused state legible at a glance. Hidden while idle / stopped to
 * keep the header uncluttered when nothing is running. Extracted so
 * `useAutomationStatus` only mounts with a real `projectId`.
 */
function RunPaneStatus({ projectId }: { projectId: string }) {
  const { status } = useAutomationStatus(projectId, undefined, {
    allowDetachedReattach: false,
  });
  if (status === "idle" || status === "stopped") return null;
  return (
    <div className={styles.headerStatus}>
      <StatusBadge status={status} />
    </div>
  );
}

/**
 * Pinned cooking strip for the Run pane. Mirrors the `loopWorking`
 * derivation used by `AutomationBar` (`PlayLoopGlyph`) so the shimmer
 * lights up in lockstep with the progress glyph — even during the
 * `starting` / `preparing` window before the first `task_started`
 * event has produced any stream deltas. Once an active task exists we
 * pass its id so the indicator can swap from the static `Cooking...`
 * fallback to `getStreamingPhaseLabel`'s richer `Thinking...` / tool
 * labels. Extracted into its own component so `useAutomationStatus`
 * only mounts when we have a real `projectId`.
 */
function RunPaneCookingIndicator({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string | undefined;
}) {
  const { status } = useAutomationStatus(projectId, undefined, {
    allowDetachedReattach: false,
  });
  const loopWorking =
    status === "starting" || status === "preparing" || status === "active";
  if (!loopWorking && !taskId) return null;
  return (
    <PinnedTaskStreamingIndicator
      taskId={taskId ?? ""}
      className={styles.pinnedStreamingIndicator}
      forceShow={loopWorking}
    />
  );
}

function loopPlanningLabel(
  status: ReturnType<typeof useAutomationStatus>["status"],
  currentStep: string | null | undefined,
): string {
  if (currentStep === "thinking") return "Thinking…";
  if (currentStep === "processing") return "Processing…";
  if (currentStep?.startsWith("tool:")) {
    return `Running ${currentStep.slice("tool:".length)}…`;
  }
  if (currentStep) return `${currentStep}…`;
  if (status === "preparing") return "Preparing…";
  return "Planning…";
}

/**
 * Loop-level placeholder shown while automation is running but no backlog
 * task has been claimed yet (harness planning / context-gather phase).
 * Falls back to the static empty state when the loop is idle.
 */
function RunPaneEmptyState({ projectId }: { projectId: string }) {
  const { status } = useAutomationStatus(projectId, undefined, {
    allowDetachedReattach: false,
  });
  const loopWorking =
    status === "starting" || status === "preparing" || status === "active";
  const activity = useLoopActivityStore(
    useShallow((s) => selectProjectActivity(s, projectId)),
  );
  if (loopWorking) {
    return (
      <div className={styles.emptyState} data-testid="run-pane-planning-placeholder">
        <CookingIndicator label={loopPlanningLabel(status, activity?.current_step)} />
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      <Text size="sm" className={styles.emptyText}>No tasks</Text>
    </div>
  );
}

export function RunSidekickPane({ searchQuery = "" }: { searchQuery?: string }) {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const { agentInstanceId } = useParams<{ agentInstanceId?: string }>();
  const { features } = useAuraCapabilities();
  const terminalTarget = useTerminalTarget({ projectId });
  const workspaceAccess = resolveWorkspaceAccess({
    workspacePath: terminalTarget.workspacePath,
    remoteWorkspacePath: terminalTarget.remoteWorkspacePath,
    remoteAgentId: terminalTarget.remoteAgentId,
    linkedWorkspace: features.linkedWorkspace,
  });
  const startAgentInstanceId =
    workspaceAccess.kind === "remote"
      ? terminalTarget.remoteAgentInstanceId
      : undefined;
  const workspaceGateActive =
    terminalTarget.status === "loading" ||
    !canStartWorkspaceAutomation(workspaceAccess, startAgentInstanceId);
  const workspaceGateTitle =
    terminalTarget.status === "loading"
      ? "Workspace is still loading"
      : terminalTarget.remoteAgentId
        ? "Remote workspace is not available yet"
        : "Build tools for local workspaces are available in Aura Desktop";
  // The Run pane shows project-scoped automation activity. Don't filter by
  // the URL's `agentInstanceId` here: that param is the *chat* agent the
  // user is currently viewing, while the loop runs on a separate
  // `Loop`-role instance (see `useAutomationStatus` -> `boundLoopId`). If
  // we filter by the chat instance id, every `task_started` row produced
  // by the loop is silently dropped because its `agent_id` is the loop
  // instance, not the chat one — the exact regression where the pane sits
  // on "No tasks" forever after Run is pressed.
  const projectTasks = useTasksForProject(projectId);
  // Render runs most-recent-last so the newest activity (and the pinned
  // cooking indicator that lives at the bottom of the pane) sits at the
  // end of the list.
  const orderedTasks = useMemo(
    () => [...projectTasks].sort((a, b) => a.updatedAt - b.updatedAt),
    [projectTasks],
  );
  // Inline search mirrors the Tasks / Specs panels: filter the rendered
  // run rows by title (falling back to the task id) so the floating
  // controls and cooking indicator keep tracking the real loop state.
  const query = searchQuery.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      query
        ? orderedTasks.filter((t) =>
            (t.title || t.taskId).toLowerCase().includes(query),
          )
        : orderedTasks,
    [orderedTasks, query],
  );
  // After `demoteStaleActive`, at most one row should be "active" per
  // pane. Pick it (the newest wins if a brief window ever produces
  // two) so we can pin its cooking indicator above the sidekick fade.
  const activeTask =
    [...projectTasks]
      .filter((t) => t.status === "active")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

  const contentRef = useRef<HTMLDivElement>(null);
  const { handleScroll, isAutoFollowing } = useScrollAnchorV2(contentRef, {
    resetKey: `${projectId ?? ""}:${agentInstanceId ?? ""}`,
  });

  return (
    <div className={styles.sidekickPane}>
      <div className={styles.contentShell}>
        <div
          className={styles.content}
          ref={contentRef}
          onScroll={handleScroll}
        >
          {projectTasks.length === 0 ? (
            projectId ? (
              <RunPaneEmptyState projectId={projectId} />
            ) : (
              <div className={styles.emptyState}>
                <Text size="sm" className={styles.emptyText}>No tasks</Text>
              </div>
            )
          ) : filteredTasks.length === 0 ? (
            <div className={styles.emptyState}>
              <Text size="sm" className={styles.emptyText}>No matching runs</Text>
            </div>
          ) : (
            filteredTasks.map((entry) =>
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
                  failureContext={entry.failureContext}
                />
              ),
            )
          )}
        </div>
        {projectId && (
          <RunPaneCookingIndicator
            projectId={projectId}
            taskId={activeTask?.taskId}
          />
        )}
        {projectId && (
          <div className={styles.runControlBar}>
            <AutomationControls
              projectId={projectId}
              workspaceGateActive={workspaceGateActive}
              workspaceGateTitle={workspaceGateTitle}
              startAgentInstanceId={startAgentInstanceId}
            />
            <RunPaneStatus projectId={projectId} />
            <RunPaneModelPicker projectId={projectId} />
          </div>
        )}
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
