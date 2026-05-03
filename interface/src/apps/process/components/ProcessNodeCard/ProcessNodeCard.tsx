import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Zap, Play, GitBranch, FileOutput, Timer, Merge, Pin, MessageSquare, Workflow, Repeat, Layers,
} from "lucide-react";
import type { ProcessNodeType } from "../../../../shared/types/enums";
import { useAgentStore } from "../../../agents/stores";
import { Avatar } from "../../../../components/Avatar";

function tint(color: string, amount: number) {
  return `color-mix(in srgb, ${color} ${amount}%, transparent)`;
}

const NODE_ICONS: Record<ProcessNodeType, React.ReactNode> = {
  ignition: <Zap size={14} />,
  action: <Play size={14} />,
  condition: <GitBranch size={14} />,
  artifact: <FileOutput size={14} />,
  delay: <Timer size={14} />,
  merge: <Merge size={14} />,
  prompt: <MessageSquare size={14} />,
  sub_process: <Workflow size={14} />,
  for_each: <Repeat size={14} />,
  group: <Layers size={14} />,
};

const NODE_COLORS: Record<ProcessNodeType, string> = {
  ignition: "var(--color-node-ignition)",
  action: "var(--color-node-action)",
  condition: "var(--color-node-condition)",
  artifact: "var(--color-node-artifact)",
  delay: "var(--color-node-delay)",
  merge: "var(--color-node-merge)",
  prompt: "var(--color-node-prompt)",
  sub_process: "var(--color-node-sub-process)",
  for_each: "var(--color-node-for-each)",
  group: "var(--color-node-group)",
};

const STATUS_COLORS: Record<NonNullable<ProcessNodeData["runStatus"]>, string> = {
  running: "var(--color-node-running)",
  completed: "var(--color-node-success)",
  failed: "var(--color-node-error)",
  skipped: "var(--color-node-default)",
};

interface ProcessNodeData {
  label: string;
  nodeType: ProcessNodeType;
  prompt?: string;
  agentId?: string;
  isPinned?: boolean;
  runStatus?: "running" | "completed" | "failed" | "skipped";
  isRenaming?: boolean;
  onRenameSubmit?: (newLabel: string) => void;
  [key: string]: unknown;
}

function RenameInput({ value, onSubmit }: { value: string; onSubmit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const committedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, []);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draftRef.current.trim();
    onSubmit(trimmed || value);
  }, [value, onSubmit]);

  useEffect(() => () => { commit(); }, [commit]);

  return (
    <input
      ref={inputRef}
      className="nodrag nopan process-node-rename-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); committedRef.current = true; onSubmit(value); }
      }}
    />
  );
}

function ProcessNodeCardInner({ data, selected }: NodeProps & { data: ProcessNodeData }) {
  const nodeType = data.nodeType;
  const color = NODE_COLORS[nodeType] ?? "var(--color-node-default)";
  const isIgnition = nodeType === "ignition";
  const isCondition = nodeType === "condition";
  const isMerge = nodeType === "merge";
  const agent = useAgentStore((s) =>
    data.agentId ? s.agents.find((a) => a.agent_id === data.agentId) : undefined,
  );

  const statusColor = data.runStatus ? STATUS_COLORS[data.runStatus] : undefined;

  const borderColor = statusColor ?? (selected ? color : "var(--color-border)");
  const shadow = statusColor
    ? `0 0 0 1px ${tint(statusColor, 25)}, 0 0 8px ${tint(statusColor, 18)}`
    : selected ? `0 0 0 1px ${tint(color, 25)}` : "var(--shadow-md)";

  return (
    <div
      style={{
        background: "var(--color-bg)",
        border: `1px solid ${borderColor}`,
        borderRadius: 0,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 12,
        paddingRight: 12,
        height: "var(--control-height-sm, 32px)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minWidth: 140,
        maxWidth: 240,
        cursor: "grab",
        boxShadow: shadow,
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {!isIgnition && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: color, width: 10, height: 10, border: "2px solid var(--color-surface)" }}
        />
      )}
      {isMerge && (
        <Handle
          type="target"
          position={Position.Left}
          id="merge-2"
          style={{
            background: color, width: 10, height: 10,
            border: "2px solid var(--color-surface)",
            top: "75%",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 20, height: 20,
            background: tint(color, 12), color,
            borderRadius: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {NODE_ICONS[nodeType]}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {data.isRenaming && data.onRenameSubmit ? (
            <RenameInput value={data.label} onSubmit={data.onRenameSubmit} />
          ) : (
            <div
              style={{
                fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", lineHeight: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {data.label}
            </div>
          )}
        </div>
        {data.isPinned && (
          <Pin size={12} style={{ color: "var(--color-text-primary)", flexShrink: 0 }} />
        )}
        {agent && (
          <Avatar avatarUrl={agent.icon ?? undefined} name={agent.name} type="agent" size={20} />
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: color, width: 10, height: 10, border: "2px solid var(--color-surface)" }}
      />
      {isCondition && (
        <Handle
          type="source"
          position={Position.Right}
          id="false"
          style={{
            background: "var(--color-node-error)", width: 10, height: 10,
            border: "2px solid var(--color-surface)",
            top: "75%",
          }}
        />
      )}
    </div>
  );
}

export const ProcessNodeCard = memo(ProcessNodeCardInner);
