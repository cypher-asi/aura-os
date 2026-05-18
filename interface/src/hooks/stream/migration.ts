import { migrateStreamPartition } from "./store";
import { migratePartitionAutoRetry } from "./partition-state";
import { migrateChatUiPartition } from "../../stores/chat-ui-store";

/**
 * Re-key every per-streamKey map that the chat surfaces partition by
 * `streamKey` from `oldKey` to `newKey`, in lockstep. Used at the two
 * server-driven session-id flip sites (project chat:
 * `build-stream-handler.ts::migrateToSession`; standalone agent chat:
 * `use-agent-chat-stream.ts::migrateToSession`) for the
 * fresh-canvas placeholder → real session id swap on `SessionReady`
 * and the mid-stream `auto_fork` / `forked_for_context` hand-off.
 *
 * The maps the orchestrator currently covers:
 *
 *  - {@link migrateStreamPartition} — Zustand `useStreamStore.entries`
 *    (events, isStreaming, streamingText, …) plus the module-level
 *    `streamMetaMap` (refs object reference, abort controller,
 *    lastAccessedAt). The refs identity is preserved so the
 *    in-flight handler's captured `partitionRefs` keeps writing to
 *    the same buffer after the flip.
 *  - {@link migratePartitionAutoRetry} — both per-surface auto-retry
 *    maps: the project-chat `partitionSendControlMap` (inFlight
 *    latch, retry timer, lastSendArgs, currentController, …) and the
 *    standalone-agent `partitionAgentReplayMap` (lastSendArgs,
 *    registered sendFn adapter). Each underlying helper short-circuits
 *    when its map has no entry at `oldKey`, so the surface that only
 *    uses one of the two maps gets a clean no-op for the other.
 *    Before Tier 3 item 9 of the session-keying review this was two
 *    separate calls plus a hand-rolled rekey block inside
 *    `use-agent-chat-stream.ts`; consolidating to one helper is what
 *    eliminates the missed-call-site pattern that previously had the
 *    standalone-agent surface skipping the send-control rekey path.
 *  - {@link migrateChatUiPartition} — the per-streamKey
 *    chat-ui-store slice (selected mode/model, pinned source image,
 *    drafts).
 *
 * Adding a new per-streamKey map should be done *here* (and inside
 * the shared `partition-state` module for any new per-surface
 * auto-retry state) rather than at every flip site, so the existing
 * surfaces inherit the migration without each having to be touched.
 *
 * Errors from the underlying helpers propagate. The current set of
 * helpers does not throw, but a `try`/`catch` here would mask a
 * future helper failing halfway and leaving the partition state
 * half-migrated; surfacing the failure at the flip site is the
 * correct behaviour.
 */
export function migrateChatPartition(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  migrateStreamPartition(oldKey, newKey);
  migratePartitionAutoRetry(oldKey, newKey);
  migrateChatUiPartition(oldKey, newKey);
}
