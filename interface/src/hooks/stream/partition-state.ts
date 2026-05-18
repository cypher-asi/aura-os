import type { ChatAttachment } from "../../api/streams";
import type { GenerationMode } from "../../constants/models";

/* ------------------------------------------------------------------ */
/*  Per-partition auto-retry / replay state.                           */
/*                                                                     */
/*  Two chat surfaces — project chat (`useChatStream`) and standalone  */
/*  agent chat (`useAgentChatStream`) — independently keep per-stream  */
/*  retry/replay state for the auto-retry mechanism: the retry budget, */
/*  the cached `lastSendArgs` / `lastUserContent` payload to re-issue, */
/*  and (in the project-chat case) the in-flight latch, abort          */
/*  controller, and optimistic-placeholder rollback ids. Conceptually  */
/*  both maps are the same thing keyed by `streamKey`, but they keep   */
/*  legitimately-different per-surface fields:                         */
/*                                                                     */
/*    - project chat tracks the abort controller, the `inFlight`       */
/*      latch, optimistic sidekick placeholder ids                     */
/*      (`pendingSpec/Task`), and a `nextSendStartsNewSession` pin,    */
/*      because the `performSend` closure owns the entire turn         */
/*      lifecycle through `partition-send-control`'s captured `ctrl`.  */
/*    - standalone agent chat tracks a `sendFn` adapter so the         */
/*      stuck-stream pill can re-fire the cached payload without       */
/*      dragging the hook return through the retry callback chain.     */
/*                                                                     */
/*  Rather than force a single shape on both, this module owns both    */
/*  maps and exposes a unified `migratePartitionAutoRetry` helper that */
/*  re-keys whichever map(s) actually have an entry at `oldKey`. The   */
/*  `migrateChatPartition` orchestrator in `./migration.ts` calls it   */
/*  once per session-id flip site, replacing the old two-call pattern  */
/*  (and the hand-rolled rekey block that standalone agent chat used   */
/*  to maintain inline) so a future per-surface map can't be missed.   */
/* ------------------------------------------------------------------ */

/**
 * Payload captured at every successful entry to `useChatStream.sendMessage`.
 * The Phase 2 auto-retry path replays the most recent capture so a transient
 * SSE / harness-WS drop can recover without losing the user's prompt.
 *
 * Mirrors the positional argument list of `UseChatStreamSendMessage` and is
 * exported here so the auto-retry replay helper can live alongside the
 * partition-keyed control state below.
 */
export interface LastSendArgs {
  content: string;
  action: string | null;
  selectedModel?: string | null;
  attachments?: ChatAttachment[];
  commands?: string[];
  projectIdOverride?: string;
  generationMode?: GenerationMode;
  sourceImageUrl?: string;
}

/**
 * Per-partition send-control state for the project-chat surface
 * (`useChatStream`).
 *
 * A "partition" is the unique `(projectId, agentInstanceId, sessionId)`
 * triple for a chat surface. The previous implementation kept these refs
 * on the `useChatStream` hook instance, which broke when a single
 * kept-mounted `<AgentChatPanel />` switched between agents while one was
 * still streaming (the `inFlight` latch carried across the switch and
 * silently no-op'd the new agent's send; the abort-controller gate
 * re-read the panel's currently-mounted partition and skipped the
 * in-flight finalize on the originating partition).
 *
 * Storing send-control state in a per-key map mirrors how `streamMetaMap`
 * and the Zustand `entries` slice are partitioned, so a single panel can
 * multiplex truly independent chats and the in-flight handler can write
 * back to the owning partition's slot via captured setters.
 */
export interface PartitionSendControl {
  /**
   * True while one chat turn POST is in flight on this partition. Used to
   * silently reject double-sends WITHIN one partition, but never
   * cross-partition.
   */
  inFlight: boolean;
  /** Phase 2 auto-retry budget. Bounded to MAX_AUTO_RETRIES inside useChatStream. */
  autoRetryCount: number;
  /** Pending retry timeout handle; cleared on stop / next user send / cleanup. */
  retryTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Payload captured for the current/most-recent turn so an auto-retry can
   * replay it.
   */
  lastSendArgs: LastSendArgs | null;
  /**
   * One-shot flag set by the retry timer so the replayed send knows not to
   * re-append the user bubble and not to reset the retry budget.
   */
  inAutoRetry: boolean;
  /**
   * Pin: the next user send on this partition should force a fresh
   * storage-session id.
   */
  nextSendStartsNewSession: boolean;
  /**
   * Optimistic sidekick placeholder ids that the in-flight send promised to
   * either promote (handler) or roll back (finally).
   */
  pendingSpecIds: string[];
  /** Mirror of pendingSpecIds for task placeholders. */
  pendingTaskIds: string[];
  /**
   * Current AbortController for the in-flight POST on this partition. Used as
   * the partition-scoped finalization sentinel in the send's finally block,
   * replacing the legacy `abortRef.current === controller` gate that re-read
   * `streamMetaMap[currentKey]` and broke under panel-swap.
   */
  currentController: AbortController | null;
}

/**
 * Payload captured at every successful entry to
 * `useAgentChatStream.sendMessage`. Mirrors `LastSendArgs` above but
 * tracks the standalone-agent positional argument list (no
 * `projectIdOverride`; uses `projectId` directly), so the two shapes
 * stay decoupled from each other's downstream serializers.
 */
export interface AgentChatLastSendArgs {
  content: string;
  action: string | null;
  selectedModel?: string | null;
  attachments?: ChatAttachment[];
  commands?: string[];
  projectId?: string;
  generationMode?: GenerationMode;
  sourceImageUrl?: string;
}

/**
 * Per-partition replay state for the standalone-agent chat surface
 * (`useAgentChatStream`).
 *
 * `sendFn` is registered by every active hook instance via `useEffect`
 * so the stuck-stream "Send anyway" pill can re-fire the cached args
 * without dragging the hook return through the retry callback chain.
 * Standalone agent chat does NOT register entries in the project-chat
 * `partitionSendControlMap`, hence the separate map: the two surfaces
 * track different shapes (the standalone branch has no captured
 * `currentController` because each `sendMessage` call owns its own
 * controller via the inFlightRef closure).
 */
export interface PartitionAgentReplay {
  lastSendArgs: AgentChatLastSendArgs | null;
  sendFn: ((args: AgentChatLastSendArgs) => Promise<void>) | null;
}

const partitionSendControlMap = new Map<string, PartitionSendControl>();
const partitionAgentReplayMap = new Map<string, PartitionAgentReplay>();

function defaultControl(): PartitionSendControl {
  return {
    inFlight: false,
    autoRetryCount: 0,
    retryTimer: null,
    lastSendArgs: null,
    inAutoRetry: false,
    nextSendStartsNewSession: false,
    pendingSpecIds: [],
    pendingTaskIds: [],
    currentController: null,
  };
}

function defaultReplay(): PartitionAgentReplay {
  return { lastSendArgs: null, sendFn: null };
}

/* ---------------- Project-chat partition send-control --------------- */

/**
 * Get-or-create the send-control entry for a project-chat partition key.
 * Mirrors the per-key pattern of `streamMetaMap` / Zustand `entries` so a
 * single `AgentChatPanel` can multiplex truly independent chats.
 */
export function getPartitionSendControl(key: string): PartitionSendControl {
  let ctrl = partitionSendControlMap.get(key);
  if (!ctrl) {
    ctrl = defaultControl();
    partitionSendControlMap.set(key, ctrl);
  }
  return ctrl;
}

/**
 * Drop a partition's send-control entry. Internal helper called from
 * {@link clearPartitionAutoRetry}; not exported because callers should
 * always clear both auto-retry maps in lockstep with the stream meta.
 */
function clearPartitionSendControl(key: string): void {
  const ctrl = partitionSendControlMap.get(key);
  if (!ctrl) return;
  if (ctrl.retryTimer != null) {
    clearTimeout(ctrl.retryTimer);
  }
  partitionSendControlMap.delete(key);
}

/**
 * Re-key the project-chat partition send-control entry from `oldKey` to
 * `newKey`. Public so tests can exercise the helper in isolation; the
 * `migrateChatPartition` orchestrator in `./migration.ts` uses
 * {@link migratePartitionAutoRetry} instead, which moves both auto-retry
 * maps at once.
 *
 * The same control object reference is reused so the captured `ctrl`
 * inside the in-flight `performSend` closure (currentController,
 * retryTimer, lastSendArgs, inFlight latch, etc.) keeps governing the
 * migrated turn — anything else would strand the abort + retry budget
 * against the now-orphan old key.
 *
 * If `newKey` already has an entry, it wins and the `oldKey` entry is
 * dropped (with its retryTimer cleared); this matches the behaviour of
 * `migrateStreamPartition` in the same scenario.
 */
function migratePartitionSendControlInternal(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  const oldCtrl = partitionSendControlMap.get(oldKey);
  if (!oldCtrl) return;
  if (partitionSendControlMap.has(newKey)) {
    if (oldCtrl.retryTimer != null) clearTimeout(oldCtrl.retryTimer);
    partitionSendControlMap.delete(oldKey);
    return;
  }
  partitionSendControlMap.set(newKey, oldCtrl);
  partitionSendControlMap.delete(oldKey);
}

/* ---------------- Standalone-agent partition replay ----------------- */

/**
 * Get-or-create the replay entry for a standalone-agent partition key.
 * Internal accessor; surface-level helpers in `use-agent-chat-stream.ts`
 * (`getLastSendArgs`, `replayLastSend`, the `useEffect` that registers
 * `sendFn`) drive this via {@link getOrCreatePartitionAgentReplay}
 * / {@link peekPartitionAgentReplay}.
 */
export function getOrCreatePartitionAgentReplay(key: string): PartitionAgentReplay {
  let entry = partitionAgentReplayMap.get(key);
  if (!entry) {
    entry = defaultReplay();
    partitionAgentReplayMap.set(key, entry);
  }
  return entry;
}

/**
 * Peek at the replay entry for `key` without minting one. Mirrors
 * `_peekPartitionSendControl` semantics; used by surface helpers that
 * want a `null`-on-miss read instead of accidentally allocating an
 * empty entry during a lookup.
 */
export function peekPartitionAgentReplay(key: string): PartitionAgentReplay | undefined {
  return partitionAgentReplayMap.get(key);
}

/**
 * Drop a partition's replay entry. Internal helper called from
 * {@link clearPartitionAutoRetry}; symmetric with
 * `clearPartitionSendControl` above. The agent replay entry has no
 * timer to clear, so the body is a single `delete`.
 */
function clearPartitionAgentReplayInternal(key: string): void {
  partitionAgentReplayMap.delete(key);
}

function migratePartitionAgentReplayInternal(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  const oldReplay = partitionAgentReplayMap.get(oldKey);
  if (!oldReplay) return;
  if (partitionAgentReplayMap.has(newKey)) {
    partitionAgentReplayMap.delete(oldKey);
    return;
  }
  partitionAgentReplayMap.set(newKey, oldReplay);
  partitionAgentReplayMap.delete(oldKey);
}

/* ---------------- Unified lifecycle helpers ------------------------- */

/**
 * Re-key both auto-retry maps from `oldKey` to `newKey` in lockstep.
 * Called by `migrateChatPartition` at the two server-driven session-id
 * flip sites (project chat: `build-stream-handler.ts::migrateToSession`;
 * standalone agent chat: `use-agent-chat-stream.ts::migrateToSession`)
 * for the fresh-canvas placeholder → real session id swap on
 * `SessionReady` and the mid-stream `auto_fork` / `forked_for_context`
 * hand-off.
 *
 * Each underlying helper short-circuits when its map has no entry at
 * `oldKey`, so calling this on a surface that only registers in one of
 * the two maps is a no-op for the other (project chat never registers
 * in the agent replay map, standalone agent chat never registers in the
 * partition send-control map). Going through a single helper removes
 * the historical missed-call-site bug pattern where standalone agent
 * chat had to hand-roll its own rekey block inside `migrateToSession`.
 */
export function migratePartitionAutoRetry(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  migratePartitionSendControlInternal(oldKey, newKey);
  migratePartitionAgentReplayInternal(oldKey, newKey);
}

/**
 * Drop both auto-retry entries for `key`. Called from
 * `pruneStreamStore`'s eviction loop so partition lifecycle stays
 * unified with the stream meta: an evicted partition can't leak its
 * retry timer / cached send payload on either surface past its last
 * live handler.
 */
export function clearPartitionAutoRetry(key: string): void {
  clearPartitionSendControl(key);
  clearPartitionAgentReplayInternal(key);
}

/* ---------------- Back-compat re-exports ---------------------------- */

/**
 * Back-compat alias for the project-chat-only rekey helper. Kept
 * because `interface/src/hooks/use-chat-stream/migration.test.ts`
 * exercises it directly as part of pinning the per-map rekey
 * semantics. The alias delegates to {@link migratePartitionAutoRetry},
 * which is a strict superset (also re-keys the standalone-agent
 * replay map); the migration test only seeds entries in the project-
 * chat map so the broader effect is a no-op there.
 */
export function migratePartitionSendControl(oldKey: string, newKey: string): void {
  migratePartitionAutoRetry(oldKey, newKey);
}

/* ---------------- Test-only helpers --------------------------------- */

/** Test-only peek for asserting on the map state in vitest. */
export function _peekPartitionSendControl(
  key: string,
): PartitionSendControl | undefined {
  return partitionSendControlMap.get(key);
}

/** Test-only reset for vitest `beforeEach` setup. */
export function _resetAllPartitionSendControl(): void {
  for (const ctrl of partitionSendControlMap.values()) {
    if (ctrl.retryTimer != null) clearTimeout(ctrl.retryTimer);
  }
  partitionSendControlMap.clear();
}

/** Test-only reset for vitest `beforeEach` setup. */
export function _resetAllPartitionAgentReplay(): void {
  partitionAgentReplayMap.clear();
}
