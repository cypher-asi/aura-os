import { EventType } from "../types/aura-events";
import type { AuraEventOfType } from "../types/aura-events";
import { useEventStore } from "./event-store/index";
import { getStreamEntry, streamMetaMap } from "../hooks/stream/store";
import { persistProcessNodeTurns } from "./process-node-turn-cache";

/* ------------------------------------------------------------------ */
/*  App-scoped process-run stream snapshot bootstrap                   */
/*                                                                     */
/*  The live `ProcessNodeLiveOutput` view in the Run preview is driven */
/*  by `useProcessNodeStream`, which populates the shared stream store */
/*  entry keyed by `process-node:<runId>:<nodeId>`. That in-memory     */
/*  state is wiped on reload. This bootstrap snapshots the entry into  */
/*  `process-node-turn-cache` whenever a node or run terminates, so    */
/*  that a page reload or WS reconnect during an in-flight run can     */
/*  rehydrate the live panel from localStorage while we wait for the   */
/*  next batch of events.                                              */
/*                                                                     */
/*  Complementary to the server-side persistence in                    */
/*  `ProcessEvent.content_blocks`, which covers post-completion view   */
/*  via `processApi.listRunEvents`. The cache exists only so the       */
/*  currently-streaming node does not flash empty during a refresh.    */
/* ------------------------------------------------------------------ */

export const PROCESS_NODE_STREAM_KEY_PREFIX = "process-node:";

export function processNodeStreamKey(runId: string, nodeId: string): string {
  return `${PROCESS_NODE_STREAM_KEY_PREFIX}${runId}:${nodeId}`;
}

function snapshotNode(runId: string, nodeId: string, processId?: string): void {
  if (!runId || !nodeId) return;
  const entry = getStreamEntry(processNodeStreamKey(runId, nodeId));
  if (!entry || entry.events.length === 0) return;
  persistProcessNodeTurns(runId, nodeId, entry.events, processId);
}

function snapshotAllNodesForRun(runId: string, processId?: string): void {
  if (!runId) return;
  const prefix = `${PROCESS_NODE_STREAM_KEY_PREFIX}${runId}:`;
  for (const key of streamMetaMap.keys()) {
    if (!key.startsWith(prefix)) continue;
    const nodeId = key.slice(prefix.length);
    if (!nodeId) continue;
    snapshotNode(runId, nodeId, processId);
  }
}

function handleProcessNodeExecuted(
  e: AuraEventOfType<typeof EventType.ProcessNodeExecuted>,
): void {
  const { run_id: runId, node_id: nodeId, status, process_id: processId } = e.content;
  const normalized = (status ?? "").toLowerCase();
  // `running` and `pending` are interim states — we only snapshot on
  // terminal transitions so the cache reflects a finished turn.
  if (normalized === "running" || normalized === "pending") return;
  snapshotNode(runId, nodeId, processId);
}

function handleProcessRunCompleted(
  e: AuraEventOfType<typeof EventType.ProcessRunCompleted>,
): void {
  snapshotAllNodesForRun(e.content.run_id, e.content.process_id);
}

function handleProcessRunFailed(
  e: AuraEventOfType<typeof EventType.ProcessRunFailed>,
): void {
  snapshotAllNodesForRun(e.content.run_id, e.content.process_id);
}

let bootstrapped = false;
let registeredDisposers: Array<() => void> = [];

/**
 * Installs the app-scoped process-run snapshot subscriptions. Safe to
 * call multiple times — re-invocations no-op until
 * `teardownProcessStreamBootstrap` is used (test-only).
 */
export function bootstrapProcessStreamSubscriptions(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  const subscribe = useEventStore.getState().subscribe;
  registeredDisposers = [
    subscribe(EventType.ProcessNodeExecuted, handleProcessNodeExecuted),
    subscribe(EventType.ProcessRunCompleted, handleProcessRunCompleted),
    subscribe(EventType.ProcessRunFailed, handleProcessRunFailed),
  ];
}

/** Test-only: undo the bootstrap so tests can re-install a fresh set. */
export function teardownProcessStreamBootstrap(): void {
  for (const dispose of registeredDisposers) {
    try {
      dispose();
    } catch {
      // Disposer failures should not block further cleanup.
    }
  }
  registeredDisposers = [];
  bootstrapped = false;
}
