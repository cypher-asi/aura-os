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

export type GroupResizeStopHandler = (nodeId: string, width?: number, height?: number) => void;

export const GRID = 20;
export const GROUP_CONFIG_ID_KEY = "group_id";
export const GROUP_CONFIG_WIDTH_KEY = "group_width";
export const GROUP_CONFIG_HEIGHT_KEY = "group_height";
export const GROUP_DEFAULT_WIDTH = 420;
export const GROUP_DEFAULT_HEIGHT = 280;

export const snap = (v: number): number => Math.round(v / GRID) * GRID;

export const EMPTY_RUNS: ProcessRun[] = [];

export const ADD_NODE_TYPES: { type: ProcessNodeType; label: string }[] = [
  { type: "prompt", label: "Prompt" },
  { type: "action", label: "Action" },
  { type: "condition", label: "Condition" },
  { type: "artifact", label: "Artifact" },
  { type: "sub_process", label: "SubProcess" },
  { type: "for_each", label: "ForEach" },
  { type: "delay", label: "Delay" },
  { type: "merge", label: "Merge" },
  { type: "group", label: "Group" },
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
  onGroupResizeStop?: GroupResizeStopHandler,
): Node[] {
  return nodes.map((n) => {
    const config = n.config ?? {};

    const baseNode: Node = {
      id: n.node_id,
      type: n.node_type === "group" ? "groupNode" : "processNode",
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
    };

    if (n.node_type === "group") {
      const width = Number(config[GROUP_CONFIG_WIDTH_KEY]) || GROUP_DEFAULT_WIDTH;
      const height = Number(config[GROUP_CONFIG_HEIGHT_KEY]) || GROUP_DEFAULT_HEIGHT;
      return {
        ...baseNode,
        data: {
          ...baseNode.data,
          onResizeStop: onGroupResizeStop,
        },
        style: { width, height, zIndex: -1 },
      };
    }

    return baseNode;
  });
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
      type: "step",
    };
  });
}
