import type { useSidekickStore } from "../../stores/sidekick-store";
import type { DisplaySessionEvent, ToolCallEntry } from "../../shared/types/stream";
import { orderIndexFromTitle } from "../../utils/collections";

type SidekickState = ReturnType<typeof useSidekickStore.getState>;

export function pushPendingSpec(
  content: { id: string; name?: string; input?: Record<string, unknown> },
  projectId: string,
  sidekick: SidekickState,
  pendingSpecIdsRef: { current: string[] },
) {
  const pendingId = `pending-${content.id}`;
  const now = new Date().toISOString();
  const input = content.input ?? {};
  const title = (input.title as string) || "Generating spec…";
  // If the streamed title already matches a real (backend-persisted) spec
  // AND we haven't started tracking this tool-call's placeholder yet, skip
  // the push entirely. Avoids a flashing duplicate row when the agent
  // re-issues `create_spec` for a title that already exists.
  const alreadyTrackingThisToolCall = pendingSpecIdsRef.current.includes(pendingId);
  if (!alreadyTrackingThisToolCall) {
    const realMatchExists = (sidekick.specs ?? []).some(
      (s) => !s.spec_id.startsWith("pending-") && s.title === title,
    );
    if (realMatchExists) return;
  }
  sidekick.pushSpec({
    spec_id: pendingId,
    project_id: projectId,
    title,
    order_index: orderIndexFromTitle(title) ?? Date.now(),
    markdown_contents: (input.markdown_contents as string) || "",
    created_at: now,
    updated_at: now,
  });
  if (!pendingSpecIdsRef.current.includes(pendingId)) {
    pendingSpecIdsRef.current.push(pendingId);
  }
}

export function pushPendingTask(
  content: { id: string; name?: string; input?: Record<string, unknown> },
  projectId: string,
  sidekick: SidekickState,
  pendingTaskIdsRef: { current: string[] },
) {
  const pendingId = `pending-${content.id}`;
  const now = new Date().toISOString();
  const input = content.input ?? {};
  const title = (input.title as string) || "Creating task…";
  const alreadyTrackingThisToolCall = pendingTaskIdsRef.current.includes(pendingId);
  if (!alreadyTrackingThisToolCall) {
    const realMatchExists = (sidekick.tasks ?? []).some(
      (t) => !t.task_id.startsWith("pending-") && t.title === title,
    );
    if (realMatchExists) return;
  }
  sidekick.pushTask({
    task_id: pendingId,
    project_id: projectId,
    spec_id: (input.spec_id as string) || "",
    title,
    description: (input.description as string) || "",
    status: "pending",
    order_index: orderIndexFromTitle(title) ?? Date.now(),
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    live_output: "",
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: now,
    updated_at: now,
  });
  if (!pendingTaskIdsRef.current.includes(pendingId)) {
    pendingTaskIdsRef.current.push(pendingId);
  }
}

export function removePendingArtifact(
  infoId: string,
  pendingIdsRef: { current: string[] },
  removeFn: (id: string) => void,
) {
  const pendingId = `pending-${infoId}`;
  const idx = pendingIdsRef.current.indexOf(pendingId);
  if (idx !== -1) {
    pendingIdsRef.current.splice(idx, 1);
    removeFn(pendingId);
  }
}

/**
 * Evict every `pending-*` placeholder currently tracked by `pendingIdsRef`
 * from the sidekick (via `removeFn`) and clear the ref. Called when the
 * chat stream ends / aborts so we don't leak placeholders across turns.
 */
export function clearAllPendingArtifacts(
  pendingIdsRef: { current: string[] },
  removeFn: (id: string) => void,
) {
  if (pendingIdsRef.current.length === 0) return;
  const ids = pendingIdsRef.current.slice();
  pendingIdsRef.current = [];
  for (const id of ids) removeFn(id);
}

/**
 * Drop any pending placeholders from `pendingIdsRef` whose matching
 * sidekick entry shares the given title, and remove them from the
 * sidekick via `removeFn`. Used by the SpecSaved / TaskSaved handlers so
 * the optimistic entry is replaced by the real entry regardless of the
 * order events arrive in and whether tool-call ids line up.
 */
export function dropPendingByTitle(
  pendingIdsRef: { current: string[] },
  title: string,
  findTitle: (id: string) => string | undefined,
  removeFn: (id: string) => void,
) {
  if (pendingIdsRef.current.length === 0) return;
  const keep: string[] = [];
  for (const id of pendingIdsRef.current) {
    if (findTitle(id) === title) {
      removeFn(id);
    } else {
      keep.push(id);
    }
  }
  pendingIdsRef.current = keep;
}

export function promotePendingSpec(
  content: { id: string; result: string },
  projectId: string,
  sidekick: SidekickState,
  pendingSpecIdsRef: { current: string[] },
) {
  try {
    const parsed = JSON.parse(content.result);
    const raw = parsed?.spec ?? parsed;
    if (!raw || typeof raw !== "object") return;

    const specId = raw.spec_id ?? raw.id;
    if (!specId || typeof specId !== "string") return;

    const now = new Date().toISOString();
    const title = raw.title ?? "Untitled";

    removePendingArtifact(content.id, pendingSpecIdsRef, (id) => sidekick.removeSpec(id));

    sidekick.pushSpec({
      spec_id: specId,
      project_id: raw.project_id ?? projectId,
      title,
      order_index: raw.order_index ?? raw.order ?? orderIndexFromTitle(title) ?? 0,
      markdown_contents: raw.markdown_contents ?? raw.content ?? "",
      created_at: raw.created_at ?? now,
      updated_at: raw.updated_at ?? now,
    });
  } catch { /* result wasn't parseable JSON -- leave pending for SpecSaved fallback */ }
}

export function promotePendingTask(
  content: { id: string; result: string },
  projectId: string,
  sidekick: SidekickState,
  pendingTaskIdsRef: { current: string[] },
) {
  try {
    const parsed = JSON.parse(content.result);
    const raw = parsed?.task ?? parsed;
    if (!raw || typeof raw !== "object") return;

    const taskId = raw.task_id ?? raw.id;
    if (!taskId || typeof taskId !== "string") return;

    const now = new Date().toISOString();

    removePendingArtifact(content.id, pendingTaskIdsRef, (id) => sidekick.removeTask(id));

    sidekick.pushTask({
      task_id: taskId,
      project_id: raw.project_id ?? projectId,
      spec_id: raw.spec_id ?? "",
      title: raw.title ?? "Untitled",
      description: raw.description ?? "",
      status: raw.status ?? "pending",
      order_index: raw.order_index ?? raw.order ?? 0,
      dependency_ids: raw.dependency_ids ?? raw.dependencies ?? [],
      parent_task_id: raw.parent_task_id ?? null,
      assigned_agent_instance_id: raw.assigned_agent_instance_id ?? null,
      completed_by_agent_instance_id: raw.completed_by_agent_instance_id ?? null,
      session_id: raw.session_id ?? null,
      execution_notes: raw.execution_notes ?? "",
      files_changed: raw.files_changed ?? [],
      live_output: raw.live_output ?? "",
      total_input_tokens: raw.total_input_tokens ?? 0,
      total_output_tokens: raw.total_output_tokens ?? 0,
      created_at: raw.created_at ?? now,
      updated_at: raw.updated_at ?? now,
    });
  } catch { /* result wasn't parseable JSON -- leave pending for TaskSaved fallback */ }
}

const TASK_TOOL_NAMES = new Set([
  "create_task",
  "update_task",
  "transition_task",
  "retry_task",
  "run_task",
]);

/**
 * After a task tool result arrives, parse the result JSON and patch the
 * matching ToolCallEntry.input so the TaskBlock header shows the task
 * title/verb-phrase and the expanded body can link out to the real task
 * in the sidekick (via task_id).
 */
export function backfillToolCallInput(
  refs: { toolCalls: { current: ToolCallEntry[] } },
  setters: { setActiveToolCalls: (v: ToolCallEntry[]) => void },
  c: Record<string, unknown>,
): void {
  try {
    const result = c.result as string;
    const parsed = JSON.parse(result);
    const raw = parsed?.task ?? parsed;
    if (!raw || typeof raw === "string") return;

    const toolId = (c.id as string) || (c.tool_use_id as string);
    const toolName = (c.name as string) || "";
    let idx = -1;
    if (toolId) {
      idx = refs.toolCalls.current.findIndex((tc) => tc.id === toolId);
    }
    if (idx === -1) {
      for (let i = refs.toolCalls.current.length - 1; i >= 0; i--) {
        const tc = refs.toolCalls.current[i];
        if (tc.name === toolName && !tc.pending && tc.result === result) {
          idx = i;
          break;
        }
      }
    }
    if (idx === -1) return;

    const patch: Record<string, unknown> = {};
    if (typeof raw.title === "string") patch.title = raw.title;
    if (typeof raw.description === "string") patch.description = raw.description;
    const resolvedTaskId = raw.task_id ?? raw.id;
    if (typeof resolvedTaskId === "string") patch.task_id = resolvedTaskId;

    if (Object.keys(patch).length === 0) return;

    refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
      i === idx ? { ...tc, input: { ...tc.input, ...patch } } : tc,
    );
    setters.setActiveToolCalls([...refs.toolCalls.current]);
  } catch { /* ignore unparseable results */ }
}

/**
 * Whether a tool name should trigger the post-result input backfill used
 * by the TaskBlock renderer.
 */
export function isTaskBackfillTool(name: string): boolean {
  return TASK_TOOL_NAMES.has(name);
}

const SPEC_TOOL_NAMES = new Set(["create_spec"]);
const TASK_PLACEHOLDER_TOOL_NAMES = new Set(["create_task"]);

/**
 * After a mid-turn page refresh, the in-flight assistant turn comes back
 * from the server with its `toolCalls` array but the local sidekick has
 * lost its `pending-*` placeholders (they live in memory only). Walk the
 * trailing in-flight turn's tool calls and re-push placeholder
 * specs/tasks for any tool calls that have not yet produced a result, so
 * the sidekick spec/task lists keep showing the in-progress rows the
 * agent is about to create.
 *
 * Tool calls that already carry a `result` are skipped — `SpecSaved` /
 * `TaskSaved` will (re)materialize the real entry from the server-side
 * specs/tasks list, and the live progress refetch loop will keep them in
 * sync. Tool calls already tracked in `pendingSpecIdsRef` /
 * `pendingTaskIdsRef` are also skipped so concurrent local writes are
 * not duplicated.
 *
 * Returns the placeholder ids that were pushed so callers can append
 * them to their respective tracking refs.
 */
export function rebuildPendingArtifactsFromHistory(
  historyMessages: DisplaySessionEvent[],
  projectId: string,
  sidekick: SidekickState,
  refs: {
    pendingSpecIdsRef: { current: string[] };
    pendingTaskIdsRef: { current: string[] };
  },
): void {
  const trailing = findTrailingInFlightAssistant(historyMessages);
  if (!trailing) return;
  const toolCalls = trailing.toolCalls ?? [];
  for (const call of toolCalls) {
    if (call.result != null) continue;
    if (!call.id) continue;
    if (SPEC_TOOL_NAMES.has(call.name)) {
      pushPendingSpec(
        { id: call.id, name: call.name, input: call.input },
        projectId,
        sidekick,
        refs.pendingSpecIdsRef,
      );
    } else if (TASK_PLACEHOLDER_TOOL_NAMES.has(call.name)) {
      pushPendingTask(
        { id: call.id, name: call.name, input: call.input },
        projectId,
        sidekick,
        refs.pendingTaskIdsRef,
      );
    }
  }
}

/**
 * Returns the trailing assistant message of the conversation if and only
 * if it carries the `inFlight` flag (server-reconstructed mid-turn
 * snapshot). Used to scope mid-turn refresh recovery effects to the
 * single in-progress turn rather than the entire transcript.
 */
export function findTrailingInFlightAssistant(
  messages: DisplaySessionEvent[],
): DisplaySessionEvent | undefined {
  if (messages.length === 0) return undefined;
  const last = messages[messages.length - 1];
  if (last.role !== "assistant") return undefined;
  if (!last.inFlight) return undefined;
  return last;
}
