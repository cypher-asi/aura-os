import type { Node, Edge } from "@xyflow/react";
import type { ProcessNode, ProcessNodeConnection, ProcessRun } from "../../../../types";
import type { ProcessNodeType } from "../../../../types/enums";
import type { NodeRunStatus } from "../../stores/process-sidekick-store";

export interface ProcessCanvasProps {
  processId: string;
  processNodes: ProcessNode[];
  processConnections: ProcessNodeConnection[];
  onTrigger?: () => void;
  onToggle?: () => void;
  onStop?: () => void;
  isEnabled?: boolean;
}

export interface RenameState {
  nodeId: string;
  onRenameSubmit: (newLabel: string) => void;
}

export const GRID = 20;

export const snap = (v: number): number => Math.round(v / GRID) * GRID;

export const EMPTY_RUNS: ProcessRun[] = [];

export const ADD_NODE_TYPES: { type: ProcessNodeType; label: string }[] = [
  { type: "prompt", label: "Prompt" },
  { type: "action", label: "Action" },
  { type: "condition", label: "Condition" },
  { type: "artifact", label: "Artifact" },
  { type: "delay", label: "Delay" },
  { type: "merge", label: "Merge" },
];

export function normalizeHandleId(
  rawHandle: string | null,
  direction: "source" | "target",
  nodeType: ProcessNodeType | undefined,
): string | undefined {
  const normalized = (rawHandle ?? "").trim().toLowerCase();

  if (direction === "source") {
    if (nodeType === "condition" && ["out-false", "false", "branch-false"].includes(normalized)) {
      return "false";
    }
    return undefined;
  }

  if (nodeType === "merge" && ["in-2", "merge-2", "second", "2"].includes(normalized)) {
    return "merge-2";
  }
  return undefined;
}

export function toFlowNodes(
  nodes: ProcessNode[],
  renaming?: RenameState,
  nodeStatuses?: Record<string, NodeRunStatus>,
): Node[] {
  return nodes.map((n) => ({
    id: n.node_id,
    type: "processNode",
    position: { x: snap(n.position_x), y: snap(n.position_y) },
    data: {
      label: n.label,
      nodeType: n.node_type,
      prompt: n.prompt,
      agentId: n.agent_id,
      isPinned: !!n.config?.pinned_output,
      runStatus: nodeStatuses?.[n.node_id],
      ...(renaming && renaming.nodeId === n.node_id
        ? { isRenaming: true, onRenameSubmit: renaming.onRenameSubmit }
        : {}),
    },
  }));
}

export function toFlowEdges(connections: ProcessNodeConnection[], nodes: ProcessNode[]): Edge[] {
  const nodeTypeById = new Map(nodes.map((n) => [n.node_id, n.node_type]));
  return connections.map((c) => {
    const sourceHandle = normalizeHandleId(c.source_handle, "source", nodeTypeById.get(c.source_node_id));
    const targetHandle = normalizeHandleId(c.target_handle, "target", nodeTypeById.get(c.target_node_id));
    return {
      id: c.connection_id,
      source: c.source_node_id,
      ...(sourceHandle ? { sourceHandle } : {}),
      target: c.target_node_id,
      ...(targetHandle ? { targetHandle } : {}),
      animated: true,
    };
  });
}
