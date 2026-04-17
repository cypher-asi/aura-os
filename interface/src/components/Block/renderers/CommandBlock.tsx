import { Terminal } from "lucide-react";
import type { ToolCallEntry } from "../../../types/stream";
import { Block } from "../Block";
import styles from "./renderers.module.css";

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
    /* Not JSON — treat whole result as stdout. */
  }
  return { stdout: result, stderr: "", exitCode: null };
}

interface CommandBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function CommandBlock({ entry, defaultExpanded }: CommandBlockProps) {
  const command = (entry.input.command as string) || "";
  const { stdout, stderr, exitCode } = parseCommandResult(entry.result);
  const hasOutput = !!stdout || !!stderr;

  const isError = entry.isError || (exitCode !== null && exitCode !== 0);
  const status = entry.pending ? "pending" : isError ? "error" : "done";

  const trailing = exitCode !== null ? (
    <span className={isError ? styles.exitError : styles.exitOk}>
      EXIT {exitCode}
    </span>
  ) : null;

  return (
    <Block
      icon={<Terminal size={12} />}
      title={
        <>
          <span className={styles.cmdPrompt}>$</span>
          <span className={styles.cmdLine}>{command || "…"}</span>
        </>
      }
      status={status}
      trailing={trailing}
      defaultExpanded={defaultExpanded || entry.pending}
      forceExpanded={entry.pending}
      autoScroll={entry.pending}
      flushBody
    >
      {hasOutput ? (
        <div style={{ padding: "6px 10px" }}>
          {stdout ? <div className={styles.cmdOutput}>{stdout}</div> : null}
          {stderr ? (
            <div className={`${styles.cmdOutput} ${styles.cmdStderr}`}>{stderr}</div>
          ) : null}
        </div>
      ) : entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : (
        <div className={styles.listEmpty}>No output.</div>
      )}
    </Block>
  );
}
