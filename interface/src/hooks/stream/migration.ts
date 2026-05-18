import { migrateAllPartitions } from "./partition-registry";
// Side-effect imports: each module below registers a
// `PartitionRegistry` at load time. Importing them here guarantees
// the full registry list is wired up by the time any caller invokes
// `migrateChatPartition`, regardless of which module the consumer
// reached for first.
import "./store";
import "./partition-state";
import "../../stores/chat-ui-store";

/**
 * Re-key every per-streamKey map registered with the partition
 * registry from `oldKey` to `newKey`, in lockstep. Used at the two
 * server-driven session-id flip sites (project chat:
 * `build-stream-handler.ts::migrateToSession`; standalone agent chat:
 * `use-agent-chat-stream.ts::migrateToSession`) for the
 * fresh-canvas placeholder → real session id swap on `SessionReady`
 * and the mid-stream `auto_fork` / `forked_for_context` hand-off.
 *
 * The orchestrator deliberately has zero knowledge of how many
 * registries exist; iteration is driven by
 * {@link migrateAllPartitions}. Adding a new per-streamKey map means
 * writing one module that calls `registerPartitionRegistry` once;
 * the orchestrator (and the `pruneStreamStore` sweep that uses
 * `clearAllPartitions`) picks it up automatically — closing the
 * structural footgun where the historical Phase-3 asymmetry
 * (standalone agent skipping `migratePartitionSendControl`) was
 * caused by remembering-to-call-each-helper at every flip site.
 *
 * The registries currently registered are:
 *
 *   - `"stream-entries"`        — Zustand `useStreamStore.entries`
 *                                  + the module-level `streamMetaMap`
 *                                  (refs identity preserved so the
 *                                  in-flight handler's captured
 *                                  `partitionRefs` keeps writing to
 *                                  the same buffer after the flip)
 *   - `"partition-send-control"` — project-chat per-key send-control
 *                                  (inFlight latch, retry timer,
 *                                  lastSendArgs, currentController, …)
 *   - `"partition-agent-replay"` — standalone-agent per-key replay
 *                                  (lastSendArgs, registered sendFn
 *                                  adapter)
 *   - `"chat-ui-partition"`     — selected mode/model, pinned source
 *                                  image, drafts
 *
 * Errors from the underlying registries propagate. The current set
 * of registries does not throw, but masking a future failure with a
 * `try`/`catch` here would leave the partition state half-migrated;
 * surfacing the failure at the flip site is the correct behaviour.
 */
export function migrateChatPartition(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  migrateAllPartitions(oldKey, newKey);
}
