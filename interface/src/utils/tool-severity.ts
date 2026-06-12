import type { ToolCallEntry } from "../shared/types/stream";
import type { BlockStatus } from "../components/Block/Block";

/**
 * Three-tier severity for tool-call feedback, replacing the old binary
 * done/error split.
 *
 * The backend already distinguishes failure classes — `tool_result.is_error`
 * (a soft failure the agent absorbed and continued past), `tool_call_failed`
 * (the harness exhausted its retry budget), and turn-level `error` events —
 * but the UI used to flatten all of them onto red. A `git remote -v` that
 * exits 128 because no repo exists yet is the agent *probing*, not a
 * failure, and should not look scary.
 *
 * - `ok`        — clean success.
 * - `attention` — the tool reported an error or a command exited non-zero,
 *                 but the agent handled it and kept going. Rendered calm
 *                 (amber dot, muted text), never red.
 * - `error`     — hard failure: the harness gave up after exhausting
 *                 retries. The only tool-level state that renders red.
 */
export type ToolSeverity = "pending" | "ok" | "attention" | "error";

export function deriveToolSeverity(
  entry: ToolCallEntry,
  exitCode?: number | null,
): ToolSeverity {
  if (entry.pending) return "pending";
  if (entry.retryExhausted) return "error";
  if (entry.isError) return "attention";
  if (exitCode != null && exitCode !== 0) return "attention";
  return "ok";
}

/** Map a {@link ToolSeverity} onto the Block shell's status prop. */
export function blockStatusForSeverity(severity: ToolSeverity): BlockStatus {
  switch (severity) {
    case "pending":
      return "pending";
    case "error":
      return "error";
    case "attention":
      return "attention";
    case "ok":
    default:
      return "done";
  }
}
