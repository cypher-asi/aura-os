import type { useSidekickStore } from "../../stores/sidekick-store";
import type { ToolCallEntry } from "../../types/stream";
import { orderIndexFromTitle } from "../../utils/collections";

type SidekickState = ReturnType<typeof useSidekickStore.getState>;

export function pushPendingSpec(
  content: { id: string; name: string; input: Record<string, unknown> },
  projectId: string,
  sidekick: SidekickState,
  pendingSpecIdsRef: { current: string[] },
) {
  const pendingId = `pending-${content.id}`;
  const now = new Date().toISOString();
  const title = (content.input.title as string) || "Generating…";
  sidekick.pushSpec({
    spec_id: pendingId,
    project_id: projectId,
    title,
    order_index: orderIndexFromTitle(title) ?? Date.now(),
    markdown_contents: (content.input.markdown_contents as string) || "",
    created_at: now,
    updated_at: now,
  });
  if (!pendingSpecIdsRef.current.includes(pendingId)) {
    pendingSpecIdsRef.current.push(pendingId);
  }
}

export function pushPendingTask(
  content: { id: string; name: string; input: Record<string, unknown> },
  projectId: string,
  sidekick: SidekickState,
  pendingTaskIdsRef: { current: string[] },
) {
  const pendingId = `pending-${content.id}`;
  const now = new Date().toISOString();
  const title = (content.input.title as string) || "Creating…";
  sidekick.pushTask({
    task_id: pendingId,
    project_id: projectId,
    spec_id: (content.input.spec_id as string) || "",
    title,
    description: (content.input.description as string) || "",
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
  pendingTaskIdsRef.current.push(pendingId);
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

/**
 * After a create_task tool result arrives, parse the result JSON and
 * patch the ToolCallEntry.input so the header summary and expanded
 * TaskCreatedIndicator can display the task title/description.
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
    let idx = -1;
    if (toolId) {
      idx = refs.toolCalls.current.findIndex((tc) => tc.id === toolId);
    }
    if (idx === -1) {
      for (let i = refs.toolCalls.current.length - 1; i >= 0; i--) {
        const tc = refs.toolCalls.current[i];
        if (tc.name === "create_task" && !tc.pending && tc.result === result) {
          idx = i;
          break;
        }
      }
    }
    if (idx === -1) return;

    refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
      i === idx
        ? { ...tc, input: { ...tc.input, title: raw.title, description: raw.description } }
        : tc,
    );
    setters.setActiveToolCalls([...refs.toolCalls.current]);
  } catch { /* ignore unparseable results */ }
}
