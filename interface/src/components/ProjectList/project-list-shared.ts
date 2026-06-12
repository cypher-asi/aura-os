import type { ListTreeNode } from "../ListTree";
import type { AgentInstance } from "../../shared/types";

export function filterTree(nodes: ListTreeNode[], q: string): ListTreeNode[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  return nodes.reduce<ListTreeNode[]>((acc, node) => {
    const labelMatch = node.label.toLowerCase().includes(lower);
    const filteredChildren = node.children ? filterTree(node.children, q) : [];
    if (labelMatch) acc.push(node);
    else if (filteredChildren.length > 0) acc.push({ ...node, children: filteredChildren });
    return acc;
  }, []);
}

export function getLastSelectedId(ids: Iterable<string>): string | null {
  let selectedId: string | null = null;
  for (const id of ids) {
    selectedId = id;
  }
  return selectedId;
}

export const STATUS_MAP: Record<string, string> = {
  running: "running",
  working: "running",
  idle: "idle",
  provisioning: "provisioning",
  hibernating: "hibernating",
  stopping: "stopping",
  stopped: "stopped",
  error: "error",
  blocked: "error",
  archived: "stopped",
};

export function resolveStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return STATUS_MAP[raw.toLowerCase()] ?? raw;
}

/**
 * Predicate for "is this `AgentInstance` row meant for user-facing
 * surfaces like the project sidebar and the project agent chat
 * route". A row is user-facing when both axes line up:
 *
 * 1. `instance_role` is `"chat"` (or absent, treated as `"chat"`).
 *    `Loop` and `Executor` rows are infrastructure — the former is
 *    the persistent automation-loop binding, the latter is the
 *    ephemeral row each `run-once` task allocates. Both must stay
 *    out of the agent list; the bug they cause is one duplicate
 *    sidebar entry per task run, since `spawn_ephemeral_executor`
 *    clones the template's name verbatim.
 *
 * 2. `source` is `null` / `undefined` (legacy data from a backend
 *    that doesn't echo the column yet) or `"ui"` (user actually
 *    clicked the "+" button in the sidebar / agent selector).
 *    Non-UI provenance — `"auto_home"` (per-org Home-project lazy
 *    bind), `"auto_project_default"` (Standard-Agent auto-attach on
 *    new project), `"sdk"` (benchmark / e2e / scripts), `"system"`
 *    (Loop / Executor rows stamped by the Rust
 *    `AgentInstanceService` helpers) — are system-created bindings
 *    that exist purely so chat persistence / redirects have a row to
 *    land on. They were the source of the repeated "Summarize This
 *    Me" rows that piled up on every dev run because the auto-rename
 *    hook seeded them from the first prompt.
 *
 * The `null`/`undefined` allowance is deliberate: it keeps existing
 * production rows that pre-date the column visible until a backfill
 * can stamp them; new writes always carry an explicit source. The
 * server stamps `source = "system"` on Loop / Executor rows so the
 * filter holds even when storage strips the `instance_role` column
 * on `list_project_agents` responses (which would otherwise let
 * those rows leak through as role-defaulted Chat rows).
 */
export function isUserFacingAgentInstance(agent: AgentInstance): boolean {
  if ((agent.instance_role ?? "chat") !== "chat") return false;
  const source = agent.source ?? null;
  return source === null || source === "ui";
}

export function getPreferredProjectAgent(
  agents: AgentInstance[],
  lastAgentId?: string | null,
): AgentInstance | undefined {
  const activeAgents = agents.filter(
    (agent) => agent.status !== "archived" && isUserFacingAgentInstance(agent),
  );
  if (activeAgents.length === 0) {
    return undefined;
  }

  return (
    (lastAgentId
      ? activeAgents.find((agent) => agent.agent_instance_id === lastAgentId)
      : undefined) ?? activeAgents[0]
  );
}
