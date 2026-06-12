import { useContextUsageStore } from "./context-usage-store";

/* ------------------------------------------------------------------ */
/*  Coalesced token-estimate bumps.                                    */
/*                                                                     */
/*  `bumpEstimatedTokens` used to be called once per SSE text/thinking */
/*  delta — i.e. per token — and each call is a Zustand setState that  */
/*  re-renders every context-ring subscriber (AgentChatPanel and the   */
/*  whole unmemoized ChatSurface under it). The ring only needs to     */
/*  move at human speed, so high-frequency callers accumulate their    */
/*  deltas here and a single store update fires per flush window.      */
/*                                                                     */
/*  Low-frequency callers (tool results, turn-end authoritative        */
/*  usage) keep calling the store directly.                            */
/* ------------------------------------------------------------------ */

const FLUSH_INTERVAL_MS = 250;

const pendingByKey = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Accumulate a token-estimate delta for `key`; the store sees one
 * combined bump per flush window instead of one per wire delta.
 */
export function bumpEstimatedTokensThrottled(key: string, tokensDelta: number): void {
  if (!Number.isFinite(tokensDelta) || tokensDelta <= 0) return;
  pendingByKey.set(key, (pendingByKey.get(key) ?? 0) + tokensDelta);
  if (flushTimer === null) {
    flushTimer = setTimeout(flushPendingTokenBumps, FLUSH_INTERVAL_MS);
  }
}

/**
 * Drop all accumulated deltas without applying them. Test-only: keeps
 * one test's unflushed deltas from leaking into the next.
 */
export function clearPendingTokenBumps(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingByKey.clear();
}

/**
 * Drain all accumulated deltas into the store immediately. Exposed so
 * tests (and any end-of-turn path that wants an exact final value) can
 * force determinism without waiting out the flush window.
 */
export function flushPendingTokenBumps(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingByKey.size === 0) return;
  const store = useContextUsageStore.getState();
  for (const [key, delta] of pendingByKey) {
    store.bumpEstimatedTokens(key, delta);
  }
  pendingByKey.clear();
}
