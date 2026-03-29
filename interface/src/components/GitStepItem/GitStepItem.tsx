import { Check, GitCommitHorizontal, Upload, XCircle } from "lucide-react";
import type { GitStep } from "../../stores/event-store";
import styles from "../Preview/Preview.module.css";

function getGitStepLabel(step: GitStep): string {
  if (step.kind === "committed") {
    const sha = step.commitSha ? step.commitSha.slice(0, 7) : "unknown";
    return `Committed ${sha}`;
  }
  if (step.kind === "commit_failed") {
    return step.reason ?? "Commit failed";
  }
  if (step.kind === "push_failed") {
    return step.reason ?? "Push failed";
  }
  const count = step.commits?.length ?? 0;
  const branch = step.branch ?? "main";
  return `Pushed ${count} commit${count !== 1 ? "s" : ""} to ${branch}`;
}

function getGitStepIcon(step: GitStep) {
  if (step.kind === "commit_failed" || step.kind === "push_failed") {
    return <XCircle size={12} />;
  }
  if (step.kind === "committed") return <GitCommitHorizontal size={12} />;
  return <Upload size={12} />;
}

export function GitStepItem({ step }: { step: GitStep }) {
  const isError = step.kind === "commit_failed" || step.kind === "push_failed";
  const isSuccess = step.kind === "pushed";
  const statusClass = isError ? styles.buildFailed : isSuccess ? styles.buildPassed : "";

  return (
    <div className={`${styles.activityItem} ${statusClass}`}>
      <span className={styles.activityIcon}>
        {getGitStepIcon(step)}
      </span>
      <span className={styles.activityBody}>
        <span className={styles.activityMessage}>{getGitStepLabel(step)}</span>
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
