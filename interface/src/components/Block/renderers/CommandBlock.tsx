import { Terminal } from "lucide-react";
import type { ToolCallEntry } from "../../../types/stream";
import { decodeCapturedOutput } from "../../../utils/format";
import { Block } from "../Block";
import styles from "./renderers.module.css";

interface CommandBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function CommandBlock({ entry, defaultExpanded }: CommandBlockProps) {
  const command = (entry.input.command as string) || "";
  const { stdout, stderr, exitCode } = decodeCapturedOutput(entry.result);
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
