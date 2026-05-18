import { migrateStreamPartition } from "./store";
import { migratePartitionSendControl } from "../use-chat-stream/partition-send-control";
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
 *  - {@link migratePartitionSendControl} — the project-chat
 *    `partitionSendControlMap` (inFlight latch, retry timer,
 *    lastSendArgs, currentController, …). Standalone agent chat
 *    does NOT register entries here, so this call is a no-op for
 *    that surface — the helper short-circuits when the source key
 *    has no entry.
 *  - {@link migrateChatUiPartition} — the per-streamKey
 *    chat-ui-store slice (selected mode/model, pinned source image,
 *    drafts).
 *
 * Adding a new per-streamKey map should be done *here* rather than
 * at every flip site, so the existing surfaces inherit the
 * migration without each having to be touched (the asymmetry that
 * previously had standalone-agent-chat skipping
 * `migratePartitionSendControl` was exactly the missed-call-site
 * pattern this orchestrator prevents).
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
  migratePartitionSendControl(oldKey, newKey);
  migrateChatUiPartition(oldKey, newKey);
}
