import { SquareTerminal } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { decodeCapturedOutput } from "../../../shared/utils/format";
import { TOOL_LABELS } from "../../../constants/tools";
import { describeCommand } from "../../../utils/derive-activity";
import {
  blockStatusForSeverity,
  deriveToolSeverity,
} from "../../../utils/tool-severity";
import { Block } from "../Block";
import styles from "./renderers.module.css";

interface CommandBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

/**
 * Build a clipboard-friendly transcript of a run_command call so the
 * always-on header copy icon yields a useful paste even when the body
 * is collapsed. Includes the prompt, the command, stdout, stderr, and
 * the exit code in shell-style format.
 */
function buildCopyText(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number | null,
): string {
  const lines: string[] = [];
  if (command) lines.push(`$ ${command}`);
  if (stdout) lines.push(stdout);
  if (stderr) lines.push(stderr);
  if (exitCode !== null) lines.push(`# exit ${exitCode}`);
  return lines.join("\n");
}

/**
 * Recover the command line from wherever it may live. The canonical key
 * is `input.command`, but marker-rehydrated history and non-JSON
 * snapshots can land it under `cmd` / `raw_input`, and some result
 * envelopes echo it back in `metadata.command`. Returns "" when nothing
 * is recorded so the header can drop the `$` prompt instead of showing
 * a meaningless `$ …`.
 */
function resolveCommand(
  input: Record<string, unknown>,
  metadata: unknown,
): string {
  for (const key of ["command", "cmd", "raw_input"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  if (metadata && typeof metadata === "object") {
    const fromMeta = (metadata as Record<string, unknown>).command;
    if (typeof fromMeta === "string" && fromMeta.trim().length > 0) {
      return fromMeta.trim();
    }
  }
  return "";
}

export function CommandBlock({ entry, defaultExpanded }: CommandBlockProps) {
  const { stdout, stderr, exitCode, metadata } = decodeCapturedOutput(entry.result);
  const command = resolveCommand(entry.input, metadata);
  const hasOutput = !!stdout || !!stderr;

  const severity = deriveToolSeverity(entry, exitCode);
  const status = blockStatusForSeverity(severity);
  // Lead with what the step is doing in plain language ("Check git
  // remotes"); the raw `$ command` stays visible in the summary slot.
  const toolLabel =
    describeCommand(command) ?? TOOL_LABELS[entry.name] ?? "Run command";

  // Exit-code badge: silent on success, quiet muted text for a non-zero
  // exit the agent handled, red only when the harness actually gave up.
  const trailing =
    exitCode !== null && (exitCode !== 0 || severity === "error") ? (
      <span className={severity === "error" ? styles.exitError : styles.exitSoft}>
        exit {exitCode}
      </span>
    ) : null;

  const emptyBodyLabel = entry.pending
    ? "Running…"
    : exitCode !== null
      ? severity === "attention"
        ? `Exited ${exitCode} — the agent handled it and continued`
        : `Exited ${exitCode}${exitCode === 0 ? " — no output" : ""}`
      : "No output captured.";

  return (
    <Block
      icon={<SquareTerminal size={12} />}
      title={toolLabel}
      summary={
        // Only render the shell prompt when there is an actual command.
        // A bare `$ …` on rows whose input was never recorded (e.g.
        // marker-rehydrated history) reads as a broken card.
        command ? (
          <>
            <span className={styles.cmdPrompt}>$</span>
            <span className={styles.cmdLine}>{command}</span>
          </>
        ) : entry.pending ? (
          <span className={styles.cmdPending}>starting…</span>
        ) : undefined
      }
      status={status}
      trailing={trailing}
      defaultExpanded={defaultExpanded || entry.pending}
      forceExpanded={entry.pending}
      autoScroll={entry.pending}
      flushBody
      copy={{
        getText: () => buildCopyText(command, stdout, stderr, exitCode),
        ariaLabel: `Copy ${command || toolLabel}`,
      }}
    >
      {hasOutput ? (
        <div style={{ padding: "6px 10px" }}>
          {stdout ? <div className={styles.cmdOutput}>{stdout}</div> : null}
          {stderr ? (
            <div
              className={`${styles.cmdOutput} ${
                severity === "error" ? styles.cmdStderrError : styles.cmdStderr
              }`}
            >
              {stderr}
            </div>
          ) : null}
        </div>
      ) : entry.isError && entry.result ? (
        <div className={severity === "error" ? styles.inlineError : styles.inlineNote}>
          {String(entry.result).slice(0, 240)}
        </div>
      ) : (
        // Never render a bare "No output." — that read as a broken card
        // even when the command was still running or had simply finished
        // cleanly. Differentiate the in-flight, clean-exit, and
        // genuinely-empty cases so the row always says something useful.
        <div className={styles.listEmpty}>{emptyBodyLabel}</div>
      )}
    </Block>
  );
}
