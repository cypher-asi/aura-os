import { Button } from "@cypher-asi/zui";
import { ReportBugButton } from "../ReportBugButton";
import { getRecentForStream } from "../../stores/stream-breadcrumbs-store";
import styles from "./StuckStreamPill.module.css";

export interface StuckStreamPillProps {
  /**
   * Wall-clock ms the stream has been considered stuck (i.e. how
   * far past `STUCK_THRESHOLD_MS` the watchdog has measured no
   * fresh wire events). `null` when not stuck — callers should
   * normally not render the pill in that state, but we accept the
   * full `StreamHealth.stuckForMs` shape for ergonomics.
   */
  stuckForMs: number | null;
  onStop: () => void;
  onRetry: () => void;
  /**
   * Phase 5: when set, the pill renders an inline `ReportBugButton`
   * pre-filled with the most recent `support_id` from the
   * breadcrumb ring for this stream. Falls back to the legacy
   * `onReport` callback when omitted (covers the standalone-tests
   * that don't depend on the breadcrumb store being populated).
   */
  streamKey?: string;
  /**
   * Optional agent id forwarded to the inline `ReportBugButton`'s
   * pre-fill bundle. Mirrors the rationale on `MessageBubble`'s
   * matching prop.
   */
  agentId?: string;
  /** Optional session id for the inline `ReportBugButton` pre-fill. */
  sessionId?: string;
  /**
   * Legacy Phase-2 fallback. Used only when `streamKey` is not
   * supplied — the modern path renders an inline
   * `ReportBugButton` whose own click handler opens
   * `NewFeedbackModal`. Kept on the prop signature so the
   * pill remains testable in isolation without mocking the
   * breadcrumb store.
   */
  onReport?: () => void;
}

function formatSeconds(ms: number | null): string {
  if (ms == null || ms < 0) return "0s";
  return `${Math.floor(ms / 1000)}s`;
}

/**
 * Stuck-stream watchdog UI. Replaces the cooking indicator after
 * `STUCK_THRESHOLD_MS` of SSE silence so the user has an explicit
 * Stop / Retry / Report affordance instead of staring at a
 * shimmering "Cooking..." for minutes.
 *
 * Uses `aria-live="polite"` so the announcement reaches screen
 * readers without interrupting whatever the user is currently
 * doing — the pill is a state change, not an emergency.
 */
export function StuckStreamPill({
  stuckForMs,
  onStop,
  onRetry,
  onReport,
  streamKey,
  agentId,
  sessionId,
}: StuckStreamPillProps) {
  const stuckLabel = formatSeconds(stuckForMs);
  // The watchdog promotes a stream to "stuck" only after
  // STUCK_THRESHOLD_MS (30s) of silence, so the wall-clock age of
  // the last event is roughly stuckForMs + 30s. We compute it
  // here so the pill's secondary copy stays self-contained
  // without having to thread `lastEventAgeMs` separately.
  const ageLabel = formatSeconds((stuckForMs ?? 0) + 30_000);
  // Phase 5: pull the most recent support_id out of the breadcrumb
  // ring for this stream so the inline `ReportBugButton` can pre-fill
  // the report title with the failure context the user just hit.
  // The lookup is read-once at render time (the breadcrumb store
  // is observed by `ReportBugButton` itself when the modal opens),
  // so we don't need a Zustand subscription here.
  const recentBreadcrumbs = streamKey ? getRecentForStream(streamKey, 20) : [];
  const latestSupportId = recentBreadcrumbs
    .filter((b) => !!b.support_id)
    .map((b) => b.support_id!)
    .at(-1);

  return (
    <div
      className={styles.stuckStreamPill}
      aria-live="polite"
      role="status"
    >
      <span className={styles.stuckStreamMessage}>
        Agent paused for {stuckLabel} — last activity was {ageLabel} ago
      </span>
      <div className={styles.stuckStreamActions}>
        <Button variant="ghost" size="sm" onClick={onStop}>
          Stop
        </Button>
        <Button variant="ghost" size="sm" onClick={onRetry} title="Resend the original prompt from the start; this does not resume unfinished work.">
          Restart turn
        </Button>
        {streamKey ? (
          <ReportBugButton
            streamKey={streamKey}
            supportId={latestSupportId}
            agentId={agentId}
            sessionId={sessionId}
            compact
            titleSuffix="stuck stream"
          />
        ) : (
          <Button variant="ghost" size="sm" onClick={onReport ?? (() => {})}>
            Report
          </Button>
        )}
      </div>
    </div>
  );
}
