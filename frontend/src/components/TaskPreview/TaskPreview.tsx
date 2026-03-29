import { Button, GroupCollapsible } from "@cypher-asi/zui";
import { GitCommitHorizontal, Loader2, Play } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { VerificationStepItem } from "../VerificationStepItem";
import { GitStepItem } from "../GitStepItem";
import { TaskMetaSection } from "../TaskMetaSection";
import { TaskFilesSection } from "../TaskFilesSection";
import { TaskOutputSection } from "../TaskOutputSection";
import { toBullets } from "../../utils/format";
import { useTaskPreviewData, useRunTaskData } from "./useTaskPreviewData";
import styles from "../Preview/Preview.module.css";

export function RunTaskButton({ task }: { task: import("../../types").Task }) {
  const { running, handleRun, visible } = useRunTaskData(task);

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={running ? <Loader2 size={14} className={styles.spinner} /> : <Play size={14} />}
      onClick={visible ? handleRun : undefined}
      disabled={!visible || running}
      title={running ? "Running..." : "Run task"}
      style={visible ? undefined : { visibility: "hidden" }}
    />
  );
}

export function TaskPreview({ task }: { task: import("../../types").Task }) {
  const {
    taskOutput, effectiveStatus, effectiveSessionId, isActive,
    elapsed, failReason, agentInstance, completedByAgent,
    retrying, handleRetry, handleViewSession,
    fileOps, notes, showNotes, streamKey,
  } = useTaskPreviewData(task);

  return (
    <>
      <TaskMetaSection
        task={task}
        effectiveStatus={effectiveStatus}
        effectiveSessionId={effectiveSessionId}
        isActive={isActive}
        elapsed={elapsed}
        failReason={failReason}
        agentInstance={agentInstance}
        completedByAgent={completedByAgent}
        retrying={retrying}
        onRetry={handleRetry}
        onViewSession={handleViewSession}
      />

      <TaskFilesSection fileOps={fileOps} />

      {taskOutput.buildSteps.length > 0 && (
        <GroupCollapsible label="Build Verification" count={taskOutput.buildSteps.length} defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.buildSteps.map((step, i) => (
                <VerificationStepItem key={i} step={step} active={i === taskOutput.buildSteps.length - 1} variant="build" />
              ))}
            </div>
          </div>
        </GroupCollapsible>
      )}

      {taskOutput.testSteps.length > 0 && (
        <GroupCollapsible label="Test Verification" count={taskOutput.testSteps.length} defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.testSteps.map((step, i) => (
                <VerificationStepItem key={i} step={step} active={i === taskOutput.testSteps.length - 1} variant="test" />
              ))}
            </div>
          </div>
        </GroupCollapsible>
      )}

      <GroupCollapsible label="Git Activity" count={taskOutput.gitSteps.length || undefined} defaultOpen className={styles.section}>
        <div className={styles.liveOutputSection}>
          <div className={styles.activityList}>
            {taskOutput.gitSteps.length > 0 ? (
              taskOutput.gitSteps.map((step, i) => (
                <GitStepItem key={i} step={step} />
              ))
            ) : (
              <div className={styles.activityItem}>
                <span className={styles.activityIcon}>
                  <GitCommitHorizontal size={12} style={{ opacity: 0.4 }} />
                </span>
                <span className={styles.activityBody}>
                  <span className={styles.activityMessage} style={{ opacity: 0.5 }}>No commits yet</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </GroupCollapsible>

      {showNotes && (
        <GroupCollapsible label="Notes" defaultOpen className={styles.section}>
          <div className={styles.notesContent}>
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {toBullets(notes || "")}
              </ReactMarkdown>
            </div>
          </div>
        </GroupCollapsible>
      )}

      <TaskOutputSection
        isActive={isActive}
        streamKey={streamKey}
        taskId={task.task_id}
        task={task}
        taskOutput={taskOutput}
        failReason={failReason}
      />
    </>
  );
}
