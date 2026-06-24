import { useEffect, useRef, useState } from "react";
import { useStreamStore } from "./store";

/**
 * Threshold (ms) past which an `isStreaming` entry with no fresh
 * wire event is considered "stuck". Phase 1 send guards consult
 * this constant directly so the queue/stuck branching matches the
 * watchdog exactly. Mirrors the value the Phase 2 watchdog UI will
 * surface.
 */
export const STUCK_THRESHOLD_MS = 30_000;

/**
 * Absolute safety cap (ms) past which a stuck stream is hard-aborted
 * as a genuine last resort. This is deliberately high (5 min): a
 * client-side abort cancels the turn (and the upstream still bills),
 * so it must only fire when the turn is almost certainly dead — i.e.
 * total wire silence for this long, with no heartbeat and no
 * successful reattach.
 *
 * It is NOT a "taking longer than usual" signal — that is the
 * non-destructive {@link STUCK_THRESHOLD_MS} pill (Stop/Retry/Report),
 * which surfaces at 30s and stays up. Genuine socket drops are caught
 * earlier and recovered transparently by the SSE idle reattach path
 * (`SSEIdleTimeoutError`, recoverable). Previously this was 60s, which
 * pre-empted that graceful reattach and abandoned (and billed) turns
 * that were still alive — sparse-but-healthy long thinking/tool gaps
 * on extended-thinking models being the worst case.
 *
 * Re-exported here so consumers and tests have a single source of truth.
 */
export const ABSOLUTE_TIMEOUT_MS = 300_000;

export interface StreamHealth {
  isStreaming: boolean;
  /**
   * Wall-clock ms of the last SSE-driven setter for this key, or
   * `null` if no wire event has landed yet for the entry.
   */
  lastEventAt: number | null;
  /**
   * `Date.now() - lastEventAt`, ticked every ~1s while streaming so
   * consumers re-render even though `lastEventAt` only changes when
   * a wire event actually arrives. `null` when not streaming or
   * when no event has been observed yet.
   */
  lastEventAgeMs: number | null;
  /** `true` iff `isStreaming && lastEventAgeMs >= STUCK_THRESHOLD_MS`. */
  isStuck: boolean;
  /**
   * How long the stream has been considered stuck in ms. `null`
   * when not stuck. Computed against `lastEventAt` (not `stuckSince`)
   * so the value increments smoothly as the watchdog ticks rather
   * than jumping when `stuckSince` is first stamped.
   */
  stuckForMs: number | null;
}

/**
 * Reactive snapshot of stream health for `key`. Re-renders every
 * ~1s while `isStreaming` is true so the watchdog UI and stuck-
 * stream send guards can re-evaluate against wall clock without
 * waiting for a wire event to flip Zustand. Cleans up the interval
 * the moment streaming ends.
 */
export function useStreamHealth(key: string): StreamHealth {
  const isStreaming = useStreamStore(
    (s) => s.entries[key]?.isStreaming ?? false,
  );
  const lastEventAt = useStreamStore(
    (s) => s.entries[key]?.lastEventAt ?? null,
  );

  // Ticker decoupled from Zustand. `lastEventAt` only changes when a
  // wire event lands, so without a periodic clock we'd never re-
  // render to flip `isStuck` true on a genuinely-stalled stream.
  // `now` is held in component state (initialized lazily so the
  // call to `Date.now` happens at mount, not during a render pass —
  // satisfies the React purity rule) and bumped every ~1s by the
  // interval below while streaming is active.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Clamp to zero: if `lastEventAt` was just stamped after a long
  // idle window, `now` (last tick or mount time) can briefly trail
  // behind it before the next interval bump. A negative age would
  // confuse downstream consumers and we'd rather report "fresh"
  // until the next tick lines the values up.
  const lastEventAgeMs =
    isStreaming && lastEventAt != null
      ? Math.max(0, now - lastEventAt)
      : null;
  const isStuck =
    isStreaming &&
    lastEventAgeMs != null &&
    lastEventAgeMs >= STUCK_THRESHOLD_MS;
  const stuckForMs =
    isStuck && lastEventAgeMs != null
      ? lastEventAgeMs - STUCK_THRESHOLD_MS
      : null;

  return { isStreaming, lastEventAt, lastEventAgeMs, isStuck, stuckForMs };
}

/**
 * One-shot last-resort auto-abort helper for the stuck-stream
 * watchdog. Invokes `onAutoTimeout` exactly once per stuck episode
 * once the last wire event landed `ABSOLUTE_TIMEOUT_MS` ago. This is
 * the destructive backstop (it aborts the turn), so it is gated on
 * the high {@link ABSOLUTE_TIMEOUT_MS} cap — the user-facing
 * "taking longer" affordance is the non-destructive 30s pill, not
 * this.
 *
 * The "exactly once per episode" guarantee is keyed on
 * `lastEventAt`: when a fresh wire event lands, `lastEventAt`
 * changes and we reset the latch so a subsequent stuck episode on
 * the same key can fire its own timeout. When `isStuck` flips off
 * (stream ended cleanly, or fresh event landed), the latch also
 * resets so reopening a chat that later goes stuck again still
 * triggers.
 *
 * `onAutoTimeout` is read via a ref so consumers do not have to
 * memoize it — the same pattern the chat panel uses for
 * `onSessionReady`.
 */
export function useStuckStreamAutoTimeout(
  health: StreamHealth,
  onAutoTimeout: () => void,
): void {
  const onAutoTimeoutRef = useRef(onAutoTimeout);
  useEffect(() => {
    onAutoTimeoutRef.current = onAutoTimeout;
  }, [onAutoTimeout]);

  // The episode is identified by the entry's `lastEventAt` value:
  // every fresh wire event re-bumps it and starts a new candidate
  // window. Storing the firing-episode timestamp prevents a single
  // stuck window from re-firing the callback on every 1s ticker
  // bump while still allowing a *new* stuck episode (after a fresh
  // event) to fire once.
  const firedForLastEventAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!health.isStreaming) {
      firedForLastEventAtRef.current = null;
      return;
    }
    if (!health.isStuck) {
      // A fresh event arrived; clear the latch so the next stuck
      // window can fire its own timeout.
      firedForLastEventAtRef.current = null;
      return;
    }
    if (health.lastEventAgeMs == null) return;
    if (health.lastEventAgeMs < ABSOLUTE_TIMEOUT_MS) return;
    if (firedForLastEventAtRef.current === health.lastEventAt) return;
    firedForLastEventAtRef.current = health.lastEventAt;
    onAutoTimeoutRef.current();
  }, [
    health.isStreaming,
    health.isStuck,
    health.lastEventAgeMs,
    health.lastEventAt,
  ]);
}
