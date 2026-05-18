// Phase 4 (parallel-session-chats plan): the two session-id flip
// sites in `build-stream-handler.ts` (the `SessionReady` branch and
// the `auto_fork` progress branch) re-key the in-flight stream lane
// via three sibling migration helpers that move state between
// per-key partition maps. These tests pin both end-to-end flip flows
// plus the idempotency / already-occupied edge cases on the helpers
// themselves so a future refactor can't silently break the
// fresh-canvas → real-id swap or the mid-stream auto-fork hand-off.

vi.mock("../../api/client", () => ({
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => false),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
  api: {},
}));

vi.mock("../../utils/chat-history", () => ({
  extractToolCalls: vi.fn(() => []),
  extractArtifactRefs: vi.fn(() => []),
}));

vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: { getState: () => ({}) },
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({}),
}));

vi.mock("../../stores/automation-loop-store", () => ({
  useAutomationLoopStore: { getState: () => ({ loopByProject: {} }) },
}));

vi.mock("../../stores/context-usage-store", () => ({
  useContextUsageStore: {
    getState: () => ({
      bumpEstimatedTokens: vi.fn(),
      setContextUtilization: vi.fn(),
    }),
  },
  approxTokensFromText: () => 0,
  mapWireContextBreakdown: (x: unknown) => x,
}));

const mockBumpVersion = vi.fn();
vi.mock("../../stores/sessions-list-store", () => ({
  useSessionsListStore: {
    getState: () => ({ bumpVersion: mockBumpVersion }),
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MutableRefObject } from "react";
import { buildStreamHandler } from "./build-stream-handler";
import { makeRefs, makeSetters } from "../stream/handlers.test-helpers";
import {
  useStreamStore,
  streamMetaMap,
  ensureEntry,
  keyForProjectSession,
  migrateStreamPartition,
} from "../stream/store";
import { useChatUIStore, migrateChatUiPartition } from "../../stores/chat-ui-store";
import {
  getPartitionSendControl,
  migratePartitionSendControl,
  _peekPartitionSendControl,
  _resetAllPartitionSendControl,
} from "./partition-send-control";
import { EventType } from "../../shared/types/aura-events";

function resetAllPartitionState(): void {
  streamMetaMap.clear();
  useStreamStore.setState({ entries: {} });
  useChatUIStore.setState({ streams: {}, drafts: {} });
  _resetAllPartitionSendControl();
}

/**
 * Seed a fully-populated in-flight lane at `key`. Returns the stable
 * references (refs object, partition send-control entry, abort
 * controller) so the test can assert that the very same object
 * identities are preserved after migration — that's what makes the
 * in-flight handler's captured closure continue to write to the
 * lane after the session-id flip.
 */
function seedLaneState(
  key: string,
  opts: {
    streamingText?: string;
    events?: number;
    draft?: string;
    selectedMode?: "code" | "plan";
    selectedModel?: string;
  } = {},
): {
  refsRef: ReturnType<typeof ensureEntry>["refs"];
  ctl: ReturnType<typeof getPartitionSendControl>;
  controller: AbortController;
} {
  const meta = ensureEntry(key);
  const controller = new AbortController();
  meta.abort = controller;

  useStreamStore.setState((s) => ({
    entries: {
      ...s.entries,
      [key]: {
        ...s.entries[key],
        isStreaming: true,
        streamingText: opts.streamingText ?? "partial assistant text",
        events: Array.from({ length: opts.events ?? 1 }, (_, i) => ({
          id: `e${i}`,
          role: "user" as const,
          content: `seed ${i}`,
        })),
      },
    },
  }));

  const ctl = getPartitionSendControl(key);
  ctl.inFlight = true;
  ctl.currentController = controller;
  ctl.lastSendArgs = { content: "seed", action: null };

  useChatUIStore.setState((s) => ({
    streams: {
      ...s.streams,
      [key]: {
        selectedMode: opts.selectedMode ?? "code",
        selectedModel: opts.selectedModel ?? "test-model",
        projectId: null,
        pinnedSourceImage: null,
      },
    },
    drafts: opts.draft != null ? { ...s.drafts, [key]: opts.draft } : s.drafts,
  }));

  return { refsRef: meta.refs, ctl, controller };
}

function makeHandlerDeps(
  coreKey: string,
  projectId: string,
  agentInstanceId: string,
  overrides: Partial<Parameters<typeof buildStreamHandler>[0]> = {},
) {
  const refs = makeRefs();
  const setters = makeSetters();
  const abortRef: MutableRefObject<AbortController | null> = { current: null };
  const sidekick = {
    setAgentStreaming: vi.fn(),
    removeSpec: vi.fn(),
    removeTask: vi.fn(),
  };
  return {
    setters,
    sidekick,
    deps: {
      projectId,
      agentInstanceId,
      selectedModel: null,
      refs,
      setters,
      abortRef,
      coreKey,
      setProgressText: vi.fn(),
      sidekickRef: { current: sidekick } as unknown as MutableRefObject<
        ReturnType<typeof import("../../stores/sidekick-store").useSidekickStore.getState>
      >,
      projectCtxRef: { current: {} } as unknown as MutableRefObject<
        ReturnType<typeof import("../../stores/project-action-store").useProjectActions>
      >,
      pendingSpecIdsRef: { current: [] } as MutableRefObject<string[]>,
      pendingTaskIdsRef: { current: [] } as MutableRefObject<string[]>,
      onSessionReady: vi.fn(),
      onPartitionMigrated: vi.fn(),
      ...overrides,
    },
  };
}

describe("Phase 4 — SessionReady fresh-canvas → real session migration", () => {
  beforeEach(() => {
    resetAllPartitionState();
    mockBumpVersion.mockReset();
  });

  it("moves the in-flight lane across all three partition maps when SessionReady fires", () => {
    const projectId = "p-1";
    const instanceId = "ai-X";
    const oldKey = keyForProjectSession(projectId, instanceId, null);
    const newKey = keyForProjectSession(projectId, instanceId, "real-session-1");

    const { refsRef, ctl, controller } = seedLaneState(oldKey, {
      streamingText: "fresh-canvas partial",
      events: 2,
      draft: "draft typed pre-flip",
      selectedModel: "test-model-X",
    });

    const { deps } = makeHandlerDeps(oldKey, projectId, instanceId);
    const handler = buildStreamHandler(deps);

    handler.onEvent({
      type: EventType.SessionReady,
      content: { session_id: "real-session-1" },
    } as unknown as Parameters<typeof handler.onEvent>[0]);

    // Stream store entry moved.
    const entries = useStreamStore.getState().entries;
    expect(entries[oldKey]).toBeUndefined();
    expect(entries[newKey]).toBeDefined();
    expect(entries[newKey].isStreaming).toBe(true);
    expect(entries[newKey].streamingText).toBe("fresh-canvas partial");
    expect(entries[newKey].events).toHaveLength(2);

    // streamMetaMap re-keyed; the refs object reference is preserved so
    // the in-flight handler's captured `partitionRefs` keeps writing to
    // the same buffer.
    expect(streamMetaMap.get(oldKey)).toBeUndefined();
    const newMeta = streamMetaMap.get(newKey);
    expect(newMeta).toBeDefined();
    expect(newMeta!.refs).toBe(refsRef);
    expect(newMeta!.abort).toBe(controller);

    // partition-send-control moved — same object reference preserved
    // so the captured `ctrl` inside `performSend` continues to govern
    // the migrated turn (abort, retry timer, lastSendArgs, ...).
    const newCtl = _peekPartitionSendControl(newKey);
    expect(newCtl).toBe(ctl);
    expect(newCtl?.inFlight).toBe(true);
    expect(newCtl?.currentController).toBe(controller);
    expect(_peekPartitionSendControl(oldKey)).toBeUndefined();

    // Chat UI store moved (selected model + draft both follow).
    const chatUi = useChatUIStore.getState();
    expect(chatUi.streams[oldKey]).toBeUndefined();
    expect(chatUi.streams[newKey]).toBeDefined();
    expect(chatUi.streams[newKey].selectedModel).toBe("test-model-X");
    expect(chatUi.drafts[oldKey]).toBeUndefined();
    expect(chatUi.drafts[newKey]).toBe("draft typed pre-flip");

    // The handler told the chat hook to update its captured partition
    // key holder and forwarded the new session id to the URL writer.
    expect(deps.onPartitionMigrated).toHaveBeenCalledWith(newKey);
    expect(deps.onSessionReady).toHaveBeenCalledWith("real-session-1");
    expect(mockBumpVersion).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 4 — auto-fork mid-stream migration", () => {
  beforeEach(() => {
    resetAllPartitionState();
    mockBumpVersion.mockReset();
  });

  it("migrates state from the old session key to the new one on a `forked_for_context` progress event", () => {
    const projectId = "p-1";
    const instanceId = "ai-X";
    const oldKey = keyForProjectSession(projectId, instanceId, "old-session");
    const newKey = keyForProjectSession(projectId, instanceId, "new-session");

    const { refsRef, ctl, controller } = seedLaneState(oldKey, {
      streamingText: "mid-stream partial",
      events: 3,
      selectedModel: "test-model-Y",
    });

    const { deps } = makeHandlerDeps(oldKey, projectId, instanceId);
    const handler = buildStreamHandler(deps);

    handler.onEvent({
      type: EventType.Progress,
      content: {
        stage: "forked_for_context",
        previous_session_id: "old-session",
        new_session_id: "new-session",
        message: "Context filling up; rolling to a new chat.",
      },
    } as unknown as Parameters<typeof handler.onEvent>[0]);

    // All three partition maps moved.
    expect(useStreamStore.getState().entries[oldKey]).toBeUndefined();
    const newEntry = useStreamStore.getState().entries[newKey];
    expect(newEntry).toBeDefined();
    expect(newEntry.isStreaming).toBe(true);
    expect(newEntry.streamingText).toBe("mid-stream partial");
    expect(newEntry.events).toHaveLength(3);

    expect(streamMetaMap.get(oldKey)).toBeUndefined();
    expect(streamMetaMap.get(newKey)?.refs).toBe(refsRef);
    expect(streamMetaMap.get(newKey)?.abort).toBe(controller);

    expect(_peekPartitionSendControl(oldKey)).toBeUndefined();
    expect(_peekPartitionSendControl(newKey)).toBe(ctl);

    expect(useChatUIStore.getState().streams[oldKey]).toBeUndefined();
    expect(useChatUIStore.getState().streams[newKey]?.selectedModel).toBe("test-model-Y");

    expect(deps.onPartitionMigrated).toHaveBeenCalledWith(newKey);
    expect(deps.onSessionReady).toHaveBeenCalledWith("new-session");
    expect(mockBumpVersion).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 4 — migrate helpers: idempotency and edge cases", () => {
  beforeEach(() => {
    resetAllPartitionState();
  });

  it("oldKey === newKey is a no-op across all three helpers (state untouched, nothing deleted)", () => {
    // Wire-level key shape: `<projectId>:<agentInstanceId>:<sessionId>`.
    // The `fresh` segment equals `FRESH_SESSION_PLACEHOLDER` from
    // `stream/store.ts`; deliberately spelled as a literal here so the
    // test pins what the helpers see in production.
    const key = "p-1:ai-X:fresh";
    const { refsRef, ctl, controller } = seedLaneState(key, {
      streamingText: "must-not-vanish",
      events: 2,
      draft: "must-not-vanish draft",
    });

    migrateStreamPartition(key, key);
    migratePartitionSendControl(key, key);
    migrateChatUiPartition(key, key);

    // Stream entry intact.
    const entry = useStreamStore.getState().entries[key];
    expect(entry).toBeDefined();
    expect(entry.streamingText).toBe("must-not-vanish");
    expect(entry.events).toHaveLength(2);

    // streamMetaMap intact, same refs object.
    expect(streamMetaMap.get(key)?.refs).toBe(refsRef);
    expect(streamMetaMap.get(key)?.abort).toBe(controller);

    // Send-control intact, same object reference.
    expect(_peekPartitionSendControl(key)).toBe(ctl);

    // ChatUI intact.
    expect(useChatUIStore.getState().streams[key]).toBeDefined();
    expect(useChatUIStore.getState().drafts[key]).toBe("must-not-vanish draft");
  });

  it("already-occupied destination wins; source is dropped without clobbering the destination", () => {
    const fromKey = "p-1:ai-X:src";
    const toKey = "p-1:ai-X:dst";

    // Source lane: must be dropped on migrate.
    const src = seedLaneState(fromKey, {
      streamingText: "source partial",
      events: 1,
      draft: "source draft",
      selectedModel: "src-model",
    });

    // Destination lane: must survive untouched (different content, draft,
    // selected model — every assertion below pins the destination's
    // values, NOT the source's).
    const dst = seedLaneState(toKey, {
      streamingText: "destination partial",
      events: 4,
      draft: "destination draft",
      selectedModel: "dst-model",
    });

    migrateStreamPartition(fromKey, toKey);
    migratePartitionSendControl(fromKey, toKey);
    migrateChatUiPartition(fromKey, toKey);

    // Source state gone from every map.
    expect(useStreamStore.getState().entries[fromKey]).toBeUndefined();
    expect(streamMetaMap.get(fromKey)).toBeUndefined();
    expect(_peekPartitionSendControl(fromKey)).toBeUndefined();
    expect(useChatUIStore.getState().streams[fromKey]).toBeUndefined();
    expect(useChatUIStore.getState().drafts[fromKey]).toBeUndefined();

    // Destination preserved — same refs / send-control object refs.
    const dstEntry = useStreamStore.getState().entries[toKey];
    expect(dstEntry).toBeDefined();
    expect(dstEntry.streamingText).toBe("destination partial");
    expect(dstEntry.events).toHaveLength(4);

    expect(streamMetaMap.get(toKey)?.refs).toBe(dst.refsRef);
    expect(streamMetaMap.get(toKey)?.refs).not.toBe(src.refsRef);

    expect(_peekPartitionSendControl(toKey)).toBe(dst.ctl);
    expect(_peekPartitionSendControl(toKey)).not.toBe(src.ctl);

    expect(useChatUIStore.getState().streams[toKey]?.selectedModel).toBe("dst-model");
    expect(useChatUIStore.getState().drafts[toKey]).toBe("destination draft");
  });
});
