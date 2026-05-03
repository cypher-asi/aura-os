# Chat-streaming hook cluster — architecture mini-doc

> **Status:** Phase 13 of the theming/frontend cleanup pass. This doc is the
> deliverable for the design phase. It documents the existing cluster, the
> overlap between hooks, and a recommendation about consolidation. After
> review, a small targeted extraction is performed; **no full unification
> is attempted in this phase**, for the reasons recorded below.

## Why this document exists

The plan flagged the chat-streaming hook cluster as the one phase that
"needs an architecture mini-doc before any code moves," because at first
glance the surface area looks duplicated (three top-level hooks, very
similar return shapes) but the lifecycles and side effects are genuinely
different per surface. A mechanical refactor would either lose behaviour
or hide it behind a discriminated-union facade that makes the divergent
responsibilities harder to read.

## 1. Inventory

### 1.1 Top-level orchestrator hooks (the "cluster")

| Hook | File | Public surface | Direct call sites |
| --- | --- | --- | --- |
| `useChatStream` | `interface/src/hooks/use-chat-stream/use-chat-stream.ts` | `({ projectId, agentInstanceId }) → { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession }` | `ProjectAgentChatPanel` in `apps/agents/components/AgentChatView/AgentChatView.tsx` (1 site) |
| `useAgentChatStream` | `interface/src/hooks/use-agent-chat-stream.ts` | `({ agentId, onTaskSaved?, onSpecSaved? }) → { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession }` | `useStandaloneAgentChat` (1 site, internal) |
| `useStandaloneAgentChat` | `interface/src/hooks/use-standalone-agent-chat.ts` | `(agentId) → ChatPanelProps` (full panel-prop bundle: `onSend`, `onStop`, `agentName`, `historyMessages`, `projects`, `selectedProjectId`, `onProjectChange`, `contextUsage`, `onNewSession`, …) | `StandaloneAgentChatPanel` and `AgentWindow` (2 sites) |

`useStandaloneAgentChat` is a higher-order composition: it wraps
`useAgentChatStream` plus `useChatHistorySync`, `useStandaloneAgentMeta`,
`useHydrateContextUtilization`, `useDelayedLoading`, the
agent-project-picker localStorage logic, and the new-session reset
sequence. It returns a complete `ChatPanelProps` so multiple `ChatPanel`
hosts (route view, desktop window) stay behaviourally identical.

### 1.2 Lower-layer modules (the shared engine)

| Module | File | Role |
| --- | --- | --- |
| `useStreamCore` | `hooks/use-stream-core.ts` | Lifecycle-only hook. Allocates a per-`storeKey` `StreamMeta` (refs, abort), creates the `StreamSetters` writing into the Zustand stream store, runs `pruneStreamStore` on remount/unmount, and exposes `baseStopStreaming` / `resetEvents`. **No React state**; returns refs + setters that the orchestrator hooks pass down to handlers. |
| `stream/store.ts` | Zustand store + module-level `streamMetaMap` | Holds reactive per-key entry state (`isStreaming`, `events`, `streamingText`, `thinkingText`, `activeToolCalls`, `timeline`, `progressText`, …) plus refcounted shared subscriptions for components that mount the same key concurrently. Implements `pruneStreamStore` LRU/TTL eviction and the `STREAM_STORE_FINALIZED_PROTECT_MS` window that keeps just-finished turns alive across in-session navigations. |
| `stream/handlers/shared.ts` | Pure helpers | `snapshotThinking`, `snapshotToolCalls`, `snapshotTimeline`, `resetStreamBuffers`, `cancelPendingStreamFlush`, `flushStreamingText`, `scheduleStreamingTextReveal` (the word-reveal RAF scheduler), `pendingToolResult`, `resolvePendingToolCallsInEvents`, `nextTimelineId`. Used by every other handler. |
| `stream/handlers/text.ts` | Pure | `handleTextDelta` — appends to `streamBuffer.current`, extends or starts a `text` timeline item, schedules the next reveal frame. |
| `stream/handlers/thinking.ts` | Pure | `handleThinkingDelta` — appends to `thinkingBuffer.current`, extends or starts a `thinking` timeline item, RAF-flushes the thinking text. |
| `stream/handlers/tool.ts` | Pure | `handleToolCallStarted`, `handleToolCallSnapshot`, `handleToolCallRetrying`, `handleToolCallFailed`, `handleToolCall`, `handleToolResult`, `resolvePendingToolCalls`, `resolveAbandonedPendingToolCalls`. |
| `stream/handlers/lifecycle.ts` | Pure | `handleEventSaved`, `handleAssistantTurnBoundary`, `handleStreamError`, `finalizeStream`, plus the `normalizeStreamError` switch (insufficient credits, agent busy, harness capacity, SSE idle-timeout / stream-lagged → variant tags). |
| `stream/hooks.ts` | Reactive hooks | `useStreamEvents`, `useIsStreaming`, `useIsWriting`, `useStreamingText`, `useThinkingText`, `useThinkingDurationMs`, `useActiveToolCalls`, `useTimeline`, `useProgressText`. Pure `useStreamStore` selectors; consumed by `ChatPanel` and friends. |
| `attachment-helpers.ts` | `hooks/attachment-helpers.ts` | `buildContentBlocks`, `buildAttachmentLabel` — already shared between both top-level hooks. |
| `use-chat-stream/build-stream-handler.ts` | Project-only | Returns the `StreamEventHandler` consumed by `useChatStream.sendMessage`. Threads project-specific side effects (sidekick spec/task placeholders, dev-loop bridging, project-context updates, agent-instance updates, `setAgentStreaming` for the `agentInstanceId`, `useContextUsageStore` token bumps) on top of the lower-layer pure handlers. |
| `use-chat-stream/optimistic-artifacts.ts` | Project-only | `pushPendingSpec`, `pushPendingTask`, `removePendingArtifact`, `clearAllPendingArtifacts`, `dropPendingByTitle`, `promotePendingSpec`, `promotePendingTask`, `backfillToolCallInput`, `isTaskBackfillTool`, `rebuildPendingArtifactsFromHistory`, `findTrailingInFlightAssistant`. Consumed by `build-stream-handler.ts` and by `useChatHistorySync` (mid-turn refresh recovery). |
| `useChatHistorySync` | `hooks/use-chat-history-sync/use-chat-history-sync.ts` | Loads persisted history, hydrates it into the stream store (with the post-stream grace window and stream-newer-than-history guards), subscribes to live `UserMessage` / `AssistantMessageEnd` / `AssistantTurnProgress` WS events, and re-arms in-flight recovery for sidekick placeholders. Consumed by both `useChatStream` callers (via `ProjectAgentChatPanel`) and `useStandaloneAgentChat`. |

### 1.3 Direct consumer call sites (Grep-confirmed)

- `useChatStream`:
  - `interface/src/apps/agents/components/AgentChatView/AgentChatView.tsx` (`ProjectAgentChatPanel`)
- `useAgentChatStream`:
  - `interface/src/hooks/use-standalone-agent-chat.ts` (only)
- `useStandaloneAgentChat`:
  - `interface/src/apps/agents/components/AgentChatView/AgentChatView.tsx` (`StandaloneAgentChatPanel`)
  - `interface/src/apps/agents/components/AgentWindow/AgentWindow.tsx` (`AgentChatWindowPanel`)

So there are **three consumer surfaces** in total, but only **one of them
talks directly to either `useChatStream` or `useAgentChatStream`** —
`ProjectAgentChatPanel`. The other two (`StandaloneAgentChatPanel` and
`AgentWindow`) go through the higher-order `useStandaloneAgentChat`.

## 2. Responsibility map

- **`useChatStream` (project + agent-instance variant)** — Owns one
  project chat turn lifecycle. Triggers the `POST /v1/projects/{pid}/agents/{aid}/events`
  SSE stream, drives the project-scoped sidekick (spec/task optimistic
  placeholders, dev-loop bridging, agent-instance updates), updates
  `useProjectActions` for `specs_title`/`specs_summary`, and toggles
  `setAgentStreaming(agentInstanceId, …)` so other panels (chat, automation
  bar) can observe streaming state per agent instance.

- **`useAgentChatStream` (org-level agent variant)** — Owns one standalone
  agent chat turn lifecycle. Triggers the `POST /v1/agents/{agentId}/sessions`
  SSE stream. Has *no* sidekick / project context. Surfaces saved specs and
  tasks via `onSpecSaved` / `onTaskSaved` callbacks. Used only as a
  building block for `useStandaloneAgentChat`.

- **`useStandaloneAgentChat` (composition)** — Owns the standalone agent
  chat *view* contract. Decides which project (if any) to attach when
  the user sends, persists that choice to localStorage, fetches history
  via `useChatHistorySync`, hydrates context utilization, and packages
  everything into `ChatPanelProps` for both the route view and the desktop
  window. Standalone agents don't have a sidekick, so it doesn't need
  `useChatStream`'s spec/task placeholder logic.

- **`useStreamCore`** — Owns *only* the stream-meta lifecycle (refs,
  abort, store entry creation, prune-on-remount). Knows nothing about
  projects, agents, sidekicks, history, or context usage.

- **`stream/handlers/*`** — Pure functions over `(refs, setters, …event)`
  with no React, no API, and no side effects beyond the buffers/setters
  passed in. Both top-level orchestrators consume them.

- **`stream/store.ts`** — Owns Zustand state, the `streamMetaMap`, and
  the eviction/finalized-protection rules. Single source of truth for
  reactive stream slices.

- **`stream/hooks.ts`** — Owns the **read** side: tiny selector hooks
  for `ChatPanel` and friends to subscribe to slices of an entry.

- **`useChatHistorySync`** — Owns the **persistence + live-refresh** side:
  IDB hydration, `fetchHistory` calls, post-stream grace window,
  history-staleness guard, mid-turn refresh recovery for sidekick
  placeholders, and the WS subscriptions for cross-agent writes.

## 3. Overlap analysis

Where **do** the two top-level hooks duplicate each other?

### 3.1 Genuinely identical structure

The pre-send / post-send boilerplate in `sendMessage` is structurally
the same in both:

```ts
if (!<entityId> || getIsStreaming(core.key)) return;
const trimmed = content.trim();
if (!trimmed && !action && !(attachments && attachments.length > 0)) return;

const userMsg = {
  id: `temp-${Date.now()}`,
  role: "user" as const,
  content: trimmed || <fallback> || buildAttachmentLabel(attachments),
  contentBlocks: buildContentBlocks(trimmed, attachments),
};
core.setEvents((prev) => [...prev, userMsg]);
core.setIsStreaming(true);
// ... (project-only side effects here in the chat-stream variant)
resetStreamBuffers(refs, setters);

abortRef.current?.abort();
const controller = new AbortController();
abortRef.current = controller;

const handler = build…Handler(...);

try {
  const shouldStartNewSession = nextSendStartsNewSessionRef.current;
  nextSendStartsNewSessionRef.current = false;
  if (_generationMode === "image") {
    core.setProgressText("Generating image...");
    await generateImageStream(userMsg.content, selectedModel, attachments, handler, controller.signal, projectId);
    return;
  }
  const modelForTurn = _generationMode ? null : selectedModel;
  await api.<send>(<entity-args>, userMsg.content, action, modelForTurn, attachments, handler, controller.signal, commands, …, shouldStartNewSession);
} catch (err) {
  if (err instanceof DOMException && err.name === "AbortError") return;
  handleStreamError(refs, setters, err);
} finally {
  if (abortRef.current === controller) {
    core.setIsStreaming(false);
    // (project-only) sidekickRef.current.setAgentStreaming(agentInstanceId, false);
    controller.abort();
    abortRef.current = null;
  }
  // (project-only) drop pending spec/task placeholders
}
```

The single most reusable extraction here is **the user-message
construction** — both hooks build `{ id: temp-…, role: "user", content,
contentBlocks }` from the same inputs (`trimmed`, `attachments`, optional
`fallback`).

### 3.2 The handler-switch overlap

Both hooks dispatch the same `EventType.*` cases. For each case, the
**call to the underlying pure handler is identical**, but the
**surrounding side effects differ**:

| Event type | `useAgentChatStream` does | `useChatStream` (via `build-stream-handler.ts`) additionally does |
| --- | --- | --- |
| `Delta`, `TextDelta` | `handleTextDelta` | + `useContextUsageStore.bumpEstimatedTokens(coreKey, …)` |
| `ThinkingDelta` | `handleThinkingDelta` | + `useContextUsageStore.bumpEstimatedTokens(coreKey, …)` |
| `Progress` | `setProgressText(stage)` | same |
| `ToolCallStarted` / `ToolUseStart` | `handleToolCallStarted` | + `pushPendingSpec` / `pushPendingTask` for `create_spec` / `create_task` |
| `ToolCallSnapshot` | `handleToolCallSnapshot` | + update placeholder title for `create_spec` / `create_task` |
| `ToolCall` | `handleToolCall` | + idempotently re-seed placeholder if missed earlier |
| `ToolResult` | `handleToolResult` | + token bump, dev-loop bridge, promote/remove placeholder, optional input backfill, `delete_spec` sidekick removal |
| `SpecSaved` | `onSpecSaved?.(spec)` callback | dropPendingByTitle + `sidekick.pushSpec` |
| `SpecsTitle`, `SpecsSummary` | — | `useProjectActions.setProject({ specs_title, specs_summary })` |
| `TaskSaved` | `onTaskSaved?.(task)` callback | dropPendingByTitle + `sidekick.pushTask` |
| `MessageEnd` | `handleEventSaved` | same |
| `AssistantMessageEnd` | `handleAssistantTurnBoundary` + context utilization update; clears `setIsStreaming` if not `tool_use` | same + clears `setAgentStreaming(agentInstanceId, false)` when not `tool_use` |
| `AgentInstanceUpdated` | — | `sidekick.notifyAgentInstanceUpdate` |
| `AssistantMessageStart`, `SessionReady`, `TokenUsage` | no-op | no-op |
| `GenerationStart` | `setProgressText("Generating image…" / "Generating 3D model…")` | same |
| `GenerationProgress` | `setProgressText(message ?? "{percent}%")` | same |
| `GenerationPartialImage` | no-op | no-op |
| `GenerationCompleted` | synth tool-call + tool-result, `finalizeStream(…, "completed")` | same + `setAgentStreaming(false)` |
| `GenerationError`, `Error` | `handleStreamError(refs, setters, content.message)` | `handleStreamError(refs, setters, content)` (whole content, not `.message`) |
| `Done` | `finalizeStream` | `finalizeStream` + `setAgentStreaming(false)` + `clearAllPendingArtifacts(specs)` + `clearAllPendingArtifacts(tasks)` |

**Every single branch has at least one project-specific side effect
in the chat-stream variant.** The `useAgentChatStream` switch is *not*
a pure subset of `useChatStream`'s switch — there are also small
divergences in the wrong direction (e.g. `GenerationError` / `Error`
extract `.message` in agent-chat-stream but pass the whole content
in chat-stream's `build-stream-handler`).

### 3.3 Genuine differences (NOT duplication)

- **Different SSE endpoints.** `api.sendEventStream(projectId, agentInstanceId, …)` vs `api.agents.sendEventStream(agentId, …)`. The argument lists differ; the streams are produced by different handlers in the backend with different lifecycle semantics.
- **Different lifecycle integration.** `useChatStream` is wired into the project sidekick (`useSidekickStore`) and the per-project automation loop (`useAutomationLoopStore`). `useAgentChatStream` is intentionally *agent-only*; the standalone agent surface deliberately doesn't carry project-scoped sidekick state.
- **Different completion semantics.** `useChatStream` flips `setAgentStreaming(agentInstanceId, …)` (a project-scoped streaming flag observed by `ChatPanel`, the automation bar, and other panels mounted against the same instance). `useAgentChatStream` has no equivalent because there's no shared agent-streaming registry at the org-agent level.
- **Different per-tool side effects.** Optimistic spec/task placeholders are inherently a project-scoped concept (specs and tasks live inside projects). The standalone agent surface deliberately doesn't try to optimistically render anything.

## 4. What a unified surface would look like

A discriminated-union sketch:

```ts
type ChatStreamMode =
  | { mode: "project"; projectId: string; agentInstanceId: string }
  | { mode: "standalone-agent"; agentId: string; onSpecSaved?: (s: Spec) => void; onTaskSaved?: (t: Task) => void };

interface ChatStreamHook {
  streamKey: string;
  sendMessage(
    content: string,
    action?: string | null,
    selectedModel?: string | null,
    attachments?: ChatAttachment[],
    commands?: string[],
    projectIdForStandalone?: string,
    generationMode?: GenerationMode,
  ): Promise<void>;
  stopStreaming(): void;
  resetEvents(msgs: DisplaySessionEvent[], opts?: { allowWhileStreaming?: boolean }): void;
  markNextSendAsNewSession(): void;
}

function useChatStream(opts: ChatStreamMode): ChatStreamHook { … }
```

Internally this would still need a `switch (opts.mode)` for at least:

1. The endpoint call (`api.sendEventStream` vs `api.agents.sendEventStream` — incompatible argument lists).
2. The handler builder (project-side-effect wiring vs agent-callback wiring).
3. The completion-side cleanup (placeholder eviction + per-instance streaming flag vs none).

Which means the unified hook would essentially be:

```ts
function useChatStream(opts: ChatStreamMode) {
  if (opts.mode === "project") return useProjectChatStreamImpl(opts);
  return useAgentChatStreamImpl(opts);
}
```

…which is a thin facade over two separate implementations. **It buys
no real consolidation.** It doesn't reduce the number of lines, it
doesn't reduce the test surface, and it makes the call site harder to
read because the discriminator now has to be threaded through every
consumer that previously knew which variant it wanted.

Worse, it would tempt future contributors to push project-specific side
effects onto the standalone-agent path "for symmetry", even though the
two surfaces are deliberately isolated (e.g. standalone agents don't have
sidekick state by design — that's a feature, not an oversight).

## 5. Recommendation

**Reject full consolidation. Keep the three hooks as separate
top-level surfaces. Extract one small genuinely-duplicated helper.**

This matches the plan's explicit guidance: *"Honest 'we don't need this'
is a valid outcome — the plan even says 'needs its own design pass, not
a mechanical refactor.'"*

### 5.1 What we keep as-is

- `useChatStream` (project variant) — owns project chat. Stays project-aware.
- `useAgentChatStream` (org-level variant) — owns standalone agent chat. Stays sidekick-free.
- `useStandaloneAgentChat` (composition) — wraps `useAgentChatStream` for both `StandaloneAgentChatPanel` and `AgentWindow`. Stays where it is.
- `useStreamCore`, `stream/handlers/*`, `stream/store.ts`, `stream/hooks.ts`, `attachment-helpers.ts` — already shared, well-tested, no changes needed.

### 5.2 What we extract

A single small helper:

```ts
// hooks/attachment-helpers.ts
export function buildUserChatMessage(
  trimmed: string,
  attachments: ChatAttachment[] | undefined,
  fallbackContent?: string,
): DisplaySessionEvent;
```

This consolidates the user-message construction that today lives in
two places (`use-chat-stream/use-chat-stream.ts` and
`use-agent-chat-stream.ts`) with the same shape:

```ts
const userMsg = {
  id: `temp-${Date.now()}`,
  role: "user" as const,
  content: trimmed || <fallback> || buildAttachmentLabel(attachments),
  contentBlocks: buildContentBlocks(trimmed, attachments),
};
```

It's a tiny extraction (~10 lines), but:

- It centralises the temp-ID convention.
- It makes the call sites read clearer (one named helper instead of an inline literal).
- It composes the existing `buildContentBlocks` / `buildAttachmentLabel` helpers in the place they're already exported from.
- It has zero behavioural risk (one shared shape replacing two structurally-identical literals).
- It's covered by the existing `useChatStream` and `useAgentChatStream` test suites which assert on `entry.events[0].role` and `entry.events[0].content`.

### 5.3 What we explicitly DO NOT do

- **No discriminated-union wrapper.** It would be a thin facade with no real consolidation, and would tempt cross-contamination of project semantics into the standalone path.
- **No "base event dispatcher".** Every `EventType.*` branch has at least one project-specific side effect in the chat-stream variant, so a base dispatcher would only handle the no-side-effect cases (`AssistantMessageStart`, `SessionReady`, `TokenUsage`, `GenerationPartialImage`) — which are already trivial no-ops.
- **No "shared sendMessage shell".** The pre/post boilerplate IS the same shape, but the callback-passing dance to share it would introduce more complexity than the duplication saves (the bodies are ~50 lines each, with non-trivial closures over refs and project state).

### 5.4 Conditions that would change this decision

Full consolidation could be revisited if:

1. The standalone-agent surface gains a sidekick / project-scoped state mirror, eliminating the lifecycle divergence.
2. The two SSE endpoints unify their payloads and signatures (e.g. the project endpoint becomes a thin alias over the agent endpoint).
3. A *third* chat-stream variant lands (e.g. cross-project chat, multi-agent chat) and the per-branch side-effect map becomes too combinatorial to keep in two parallel switches.

Until then, the per-branch divergence map in §3.2 is small enough to
review eyeball-by-eyeball, and the parallel switches stay readable.

## 6. Migration plan (small extraction)

1. **Commit (after this doc):** Add `buildUserChatMessage` to
   `hooks/attachment-helpers.ts`, export it, and migrate both
   `use-chat-stream/use-chat-stream.ts` and
   `use-agent-chat-stream.ts` to use it. Single commit; no behaviour
   change; existing tests cover both call sites.

That's the entire migration. No second-stage commits, no consumer
updates, no hook deletions.

## 7. Risks and rollback

- **Risk: subtle change in user-message `id` or `content` formatting.**
  Mitigation: the helper reproduces the existing literal exactly. The
  `useChatStream` and `useAgentChatStream` test suites assert on
  `events[0].role === "user"` and `events[0].content === <expected>`,
  so any drift is caught.
- **Risk: import cycle.** `attachment-helpers.ts` already imports from
  `shared/types/stream` and `api/streams`. Adding a `DisplaySessionEvent`
  return type is a no-op — the type is already in scope.
- **Rollback.** Single-commit revert. The helper has a single new
  export and two consumer migrations; reverting the commit restores the
  inline literals in both hooks with no other side effects.

## 8. Open questions for future phases

- The `_generationMode` parameter is named with a leading underscore in
  both `sendMessage` signatures, which the eslint config typically uses
  to silence "unused" warnings. Here it IS used. The naming is a vestige
  of an earlier signature; renaming is a separate cosmetic phase.
- The `commands` parameter is wired through to the SSE call but isn't
  documented anywhere obvious. This is also out of scope for Phase 13.
- The `useChatHistorySync` mid-turn recovery flow (lines 367–412 in
  `use-chat-history-sync.ts`) calls into `optimistic-artifacts` for
  `findTrailingInFlightAssistant` and `rebuildPendingArtifactsFromHistory`.
  That coupling is deliberate — both consumers (the orchestrator and the
  history sync) need to know about the same placeholder rules — but it
  means moving `optimistic-artifacts` somewhere "more shared" should
  happen with the chat-history-sync owner in the room.
