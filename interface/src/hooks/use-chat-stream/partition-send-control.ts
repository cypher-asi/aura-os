import type { ChatAttachment } from "../../api/streams";
import type { GenerationMode } from "../../constants/models";

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
 * Per-partition send-control state.
 *
 * A "partition" is the unique `(projectId, agentInstanceId)` pair for a chat
 * surface. The previous implementation kept these refs on the
 * `useChatStream` hook instance, which broke when a single kept-mounted
 * `<AgentChatPanel />` switched between agents while one was still streaming
 * (the inFlight latch carried across the switch and silently no-op'd the new
 * agent's send; the abort-controller gate re-read the panel's currently-mounted
 * partition and skipped the in-flight finalize on the originating partition).
 *
 * Storing send-control state in a per-key map mirrors how `streamMetaMap` and
 * the Zustand `entries` slice are partitioned, so a single panel can multiplex
 * truly independent chats and the in-flight handler can write back to the
 * owning partition's slot via captured setters.
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

const partitionSendControlMap = new Map<string, PartitionSendControl>();

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

/**
 * Get-or-create the send-control entry for a partition key. Mirrors the
 * per-key pattern of `streamMetaMap` / Zustand `entries` so a single
 * `AgentChatPanel` can multiplex truly independent chats.
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
 * Drop a partition's send-control entry. Called from `pruneStreamStore`'s
 * eviction loop so partition lifecycle stays unified with the stream meta.
 */
export function clearPartitionSendControl(key: string): void {
  const ctrl = partitionSendControlMap.get(key);
  if (!ctrl) return;
  if (ctrl.retryTimer != null) {
    clearTimeout(ctrl.retryTimer);
  }
  partitionSendControlMap.delete(key);
}

/**
 * Re-key the in-flight send-control entry from `oldKey` to `newKey`.
 * Sibling of `migrateStreamPartition` in `stream/store.ts`; called
 * from `build-stream-handler.ts` whenever the server flips a
 * fresh-canvas placeholder session id to a real one (`SessionReady`)
 * or auto-forks mid-stream to a new session. The same control object
 * reference is reused so the captured `ctrl` inside the in-flight
 * `performSend` closure (currentController, retryTimer, lastSendArgs,
 * inFlight latch, etc.) keeps governing the migrated turn — anything
 * else would strand the abort + retry budget against the now-orphan
 * old key.
 *
 * If `newKey` already has an entry, it wins and the `oldKey` entry is
 * dropped (with its retryTimer cleared); this matches the behaviour of
 * `migrateStreamPartition` in the same scenario.
 */
export function migratePartitionSendControl(oldKey: string, newKey: string): void {
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
