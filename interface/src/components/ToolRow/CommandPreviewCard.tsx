import { useState } from "react";
import type { ToolCallEntry } from "../../types/stream";
import styles from "./CommandPreviewCard.module.css";

interface CommandPreviewCardProps {
  entry: ToolCallEntry;
}

function parseCommandResult(result: string | undefined): {
  stdout: string;
  stderr: string;
  exitCode: number | null;
} {
  if (!result) return { stdout: "", stderr: "", exitCode: null };

  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === "object" && parsed !== null) {
      const stdout = typeof parsed.stdout === "string" ? parsed.stdout : "";
      const stderr = typeof parsed.stderr === "string" ? parsed.stderr : "";
      const exitCode = typeof parsed.exit_code === "number" ? parsed.exit_code : null;
      return { stdout, stderr, exitCode };
    }
  } catch {
    // Not JSON — treat the whole result as stdout
  }

  return { stdout: result, stderr: "", exitCode: null };
}

export function CommandPreviewCard({ entry }: CommandPreviewCardProps) {
  const command = (entry.input.command as string) || "";
  const { stdout, stderr, exitCode } = parseCommandResult(entry.result);
  const [expanded, setExpanded] = useState(true);

  const hasOutput = stdout || stderr;
  const isError = entry.isError || (exitCode !== null && exitCode !== 0);

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.prompt}>$</span>
        <span className={styles.command}>{command}</span>
        {exitCode !== null && (
          <span className={`${styles.exitCode} ${isError ? styles.exitCodeError : ""}`}>
            EXIT {exitCode}
          </span>
        )}
      </button>
      {expanded && hasOutput && (
        <div className={styles.body}>
          {stdout && (
            <div className={styles.output}>{stdout}</div>
          )}
          {stderr && (
            <div className={`${styles.output} ${styles.stderrOutput}`}>{stderr}</div>
          )}
        </div>
      )}
    </div>
  );
}
