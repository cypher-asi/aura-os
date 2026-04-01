import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Zap, Play, GitBranch, FileOutput, Timer, Merge,
} from "lucide-react";
import type { ProcessNodeType } from "../../../types/enums";

const NODE_ICONS: Record<ProcessNodeType, React.ReactNode> = {
  ignition: <Zap size={16} />,
  action: <Play size={16} />,
  condition: <GitBranch size={16} />,
  artifact: <FileOutput size={16} />,
  delay: <Timer size={16} />,
  merge: <Merge size={16} />,
};

const NODE_COLORS: Record<ProcessNodeType, string> = {
  ignition: "#f59e0b",
  action: "#3b82f6",
  condition: "#8b5cf6",
  artifact: "#10b981",
  delay: "#6b7280",
  merge: "#ec4899",
};

interface ProcessNodeData {
  label: string;
  nodeType: ProcessNodeType;
  prompt?: string;
  [key: string]: unknown;
}

function ProcessNodeCardInner({ data, selected }: NodeProps & { data: ProcessNodeData }) {
  const nodeType = data.nodeType;
  const color = NODE_COLORS[nodeType] ?? "#6b7280";
  const isIgnition = nodeType === "ignition";
  const isCondition = nodeType === "condition";
  const isMerge = nodeType === "merge";

  return (
    <div
      style={{
        background: "var(--color-bg, #0d0d1a)",
        border: `1px solid ${selected ? color : "var(--color-border)"}`,
        borderRadius: 0,
        padding: "12px 16px",
        minWidth: 180,
        maxWidth: 240,
        cursor: "grab",
        boxShadow: selected ? `0 0 0 1px ${color}40` : "0 2px 8px rgba(0,0,0,0.2)",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {!isIgnition && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: color, width: 10, height: 10, border: "2px solid var(--color-bg-surface, #1a1a2e)" }}
        />
      )}
      {isMerge && (
        <Handle
          type="target"
          position={Position.Left}
          id="merge-2"
          style={{
            background: color, width: 10, height: 10,
            border: "2px solid var(--color-bg-surface, #1a1a2e)",
            top: "75%",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: data.prompt ? 6 : 0 }}>
        <div
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: `${color}20`, color,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {NODE_ICONS[nodeType]}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text, #eee)", lineHeight: 1.3 }}>
          {data.label}
        </div>
      </div>

      {data.prompt && (
        <div
          style={{
            fontSize: 11, color: "var(--color-text-muted, #888)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 200, marginTop: 4,
          }}
        >
          {data.prompt}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: color, width: 10, height: 10, border: "2px solid var(--color-bg-surface, #1a1a2e)" }}
      />
      {isCondition && (
        <Handle
          type="source"
          position={Position.Right}
          id="false"
          style={{
            background: "#ef4444", width: 10, height: 10,
            border: "2px solid var(--color-bg-surface, #1a1a2e)",
            top: "75%",
          }}
        />
      )}
    </div>
  );
}

export const ProcessNodeCard = memo(ProcessNodeCardInner);
