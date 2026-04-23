import { Check, CloudOff, GitCommitHorizontal, RotateCcw, Upload, XCircle } from "lucide-react";
import type { GitStep } from "../../stores/event-store/index";
import styles from "../Preview/Preview.module.css";

function getGitStepLabel(step: GitStep): string {
  if (step.kind === "committed") {
    const sha = step.commitSha ? step.commitSha.slice(0, 7) : "unknown";
    return `Committed ${sha}`;
  }
  if (step.kind === "commit_failed") {
    return step.reason ?? "Commit failed";
  }
  if (step.kind === "commit_rolled_back") {
    const sha = step.commitSha ? step.commitSha.slice(0, 7) : "unknown";
    const reason = step.reason ?? "Definition of Done gate rejected the commit";
    return `Rolled back ${sha}: ${reason}`;
  }
  if (step.kind === "push_failed") {
    if (step.commitSha) {
      return `Push failed for ${step.commitSha.slice(0, 7)}: ${step.reason ?? "unknown reason"}`;
    }
    return step.reason ?? "Push failed";
  }
  if (step.kind === "push_deferred") {
    const reason = step.reason ?? "remote unavailable";
    if (step.commitSha) {
      return `Push deferred for ${step.commitSha.slice(0, 7)}: ${reason}`;
    }
    return `Push deferred: ${reason}`;
  }
  const count = step.commits?.length ?? 0;
  const branch = step.branch ?? "main";
  return `Pushed ${count} commit${count !== 1 ? "s" : ""} to ${branch}`;
}

function getGitStepIcon(step: GitStep) {
  if (step.kind === "commit_failed" || step.kind === "push_failed") {
    return <XCircle size={12} />;
  }
  if (step.kind === "commit_rolled_back") return <RotateCcw size={12} />;
  if (step.kind === "push_deferred") return <CloudOff size={12} />;
  if (step.kind === "committed") return <GitCommitHorizontal size={12} />;
  return <Upload size={12} />;
}

export function GitStepItem({ step }: { step: GitStep }) {
  const isError = step.kind === "commit_failed" || step.kind === "push_failed";
  const isRollback = step.kind === "commit_rolled_back";
  const isSuccess = step.kind === "pushed";
  const isDeferred = step.kind === "push_deferred";
  // push_deferred is deliberately NOT `isError`: the backend treats a
  // deferred push as a non-terminal outcome (the task itself still ran
  // to local completion), so a red row would overstate the severity. We
  // style it muted instead, matching `Rolled back` visual weight.
  const statusClass = isError ? styles.buildFailed : isSuccess ? styles.buildPassed : "";

  const rollbackStyle = isRollback
    ? { textDecoration: "line-through" as const, opacity: 0.65 }
    : isDeferred
      ? { opacity: 0.75 }
      : undefined;

  return (
    <div className={`${styles.activityItem} ${statusClass}`}>
      <span className={styles.activityIcon}>
        {getGitStepIcon(step)}
      </span>
      <span className={styles.activityBody}>
        <span className={styles.activityMessage} style={rollbackStyle}>
          {getGitStepLabel(step)}
        </span>
        {step.kind === "pushed" && step.commits && step.commits.length > 0 && (
          <div style={{ marginTop: 4, fontSize: "0.8em", opacity: 0.7 }}>
            {step.commits.map((c) => (
              <div key={c.sha} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Check size={10} />
                <code>{c.sha.slice(0, 7)}</code>
                <span>{c.message}</span>
              </div>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}
