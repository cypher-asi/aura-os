import { useState } from "react";
import { Button, Text, ModalConfirm } from "@cypher-asi/zui";
import { BrainCircuit, Pause, Square } from "lucide-react";
import { StatusBadge } from "../StatusBadge";
import { PlayLoopGlyph } from "../PlayLoopGlyph";
import type { ProjectId } from "../../shared/types";
import { useAutomationStatus } from "./useAutomationStatus";
import { AutomationModelPicker } from "./AutomationModelPicker";
import { LoopEngineeringPanel } from "./LoopEngineeringPanel";
import styles from "./AutomationBar.module.css";

interface AutomationBarProps {
  projectId: ProjectId;
}

export function AutomationBar({ projectId }: AutomationBarProps) {
  const [loopEngineeringOpen, setLoopEngineeringOpen] = useState(false);
  const {
    status, agentCount, canPlay, canPause, canStop,
    canStartLoopEngineering,
    confirmStop, setConfirmStop,
    handleStart, handleStartLoopEngineering,
    handlePause, handleStop, handleStopConfirm,
    stopError, clearStopError,
    startError, clearStartError, handleResetAndRetry,
    loopEngineeringContract,
  } = useAutomationStatus(projectId);

  // Whether the start error is the structured "harness has a stale
  // automaton" 409. Drives the modal copy (Reset vs Dismiss) so the
  // user sees the right affordance for the wedge case without us
  // hand-parsing the free-text message in JSX.
  const startErrorIsWedge =
    startError?.code === "automation_already_running";

  // Lock the picker once the loop is starting / preparing / active /
  // paused: the model is captured at `startLoop` time, so flipping it
  // mid-run would have no effect on the running loop. Keeping the
  // trigger interactive in that window would lie to the user about
  // what's actually controlling the run.
  const modelPickerDisabled = status !== "idle" && status !== "stopped";

  // True whenever the loop is actively doing work. We light the Play
  // button's progress ring in all three sub-phases — `starting`
  // (HTTP `startLoop` in flight), `preparing` (server accepted, no
  // `task_started` yet), and `active` (a task is running) — so the
  // visual signal does not flicker off between phases the way the
  // old `starting || preparing` spinner did.
  const loopWorking =
    status === "starting" || status === "preparing" || status === "active";
  const loopEngineeringActive =
    loopEngineeringContract != null &&
    status !== "idle" &&
    status !== "stopped";
  const activeLoopEngineering = loopEngineeringActive
    ? loopEngineeringContract
    : null;
  const verifierCount = activeLoopEngineering?.verifierCommands.length ?? 0;
  const criteriaCount = activeLoopEngineering?.successCriteria.length ?? 0;

  return (
    <>
      <div className={styles.automationStack}>
        <div className={styles.automationBar}>
          <div className={styles.automationLabel}>
            <Text size="sm" className={styles.automationLabelBold}>
              Automation
            </Text>
            <StatusBadge status={status} />
            {loopEngineeringActive ? (
              <Text size="xs" className={styles.loopModeBadge}>
                Loop Engineering
              </Text>
            ) : null}
            {agentCount > 1 && (
              <Text size="xs" className={styles.automationAgentCount}>
                {agentCount} agents
              </Text>
            )}
          </div>
          <div className={styles.automationModelSlot}>
            <AutomationModelPicker
              projectId={projectId}
              disabled={modelPickerDisabled}
            />
          </div>
          <div className={styles.automationControls}>
            <Button
              variant="ghost"
              size="sm"
              icon={<BrainCircuit size={14} />}
              onClick={() => setLoopEngineeringOpen((open) => !open)}
              title="Loop Engineering"
              className={
                loopEngineeringOpen ? styles.loopModeActive : undefined
              }
            >
              Loop
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<PlayLoopGlyph active={loopWorking} size={14} />}
              onClick={handleStart}
              disabled={!canPlay}
              title={status === "paused" ? "Resume" : "Start"}
              className={loopWorking ? styles.playButtonActive : undefined}
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Pause size={14} />}
              onClick={handlePause}
              disabled={!canPause}
              title="Pause"
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Square size={14} />}
              onClick={handleStop}
              disabled={!canStop}
              title="Stop"
            />
          </div>
        </div>

        {loopEngineeringOpen && (
          <LoopEngineeringPanel
            projectId={projectId}
            canStart={canStartLoopEngineering}
            onStart={handleStartLoopEngineering}
          />
        )}
        {activeLoopEngineering && !loopEngineeringOpen ? (
          <div className={styles.loopActiveSummary} role="status">
            <BrainCircuit size={14} />
            <div className={styles.loopActiveCopy}>
              <Text size="xs" className={styles.loopActiveTitle}>
                Loop Engineering active
              </Text>
              <Text size="xs" className={styles.loopActiveGoal}>
                {activeLoopEngineering.goal}
              </Text>
            </div>
            <Text size="xs" className={styles.loopActiveMeta}>
              {activeLoopEngineering.maxIterations} iteration
              {activeLoopEngineering.maxIterations === 1 ? "" : "s"} /{" "}
              {criteriaCount} criteria / {verifierCount || "auto"} verifier
              {verifierCount === 1 ? "" : "s"}
            </Text>
          </div>
        ) : null}
      </div>

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

      {startError && (
        <ModalConfirm
          isOpen
          onClose={clearStartError}
          onConfirm={startErrorIsWedge ? handleResetAndRetry : clearStartError}
          title={
            startErrorIsWedge
              ? "Automation is wedged on the harness"
              : "Start failed"
          }
          message={startError.message}
          confirmLabel={startErrorIsWedge ? "Reset and retry" : "Dismiss"}
          cancelLabel={startErrorIsWedge ? "Cancel" : "Close"}
          danger={startErrorIsWedge}
        />
      )}
    </>
  );
}
