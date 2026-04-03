import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Zap, Play, GitBranch, FileOutput, Timer, Merge,
} from "lucide-react";
import type { ProcessNodeType } from "../../../types/enums";
import { useAgentStore } from "../../agents/stores";
import { Avatar } from "../../../components/Avatar";

const NODE_ICONS: Record<ProcessNodeType, React.ReactNode> = {
  ignition: <Zap size={14} />,
  action: <Play size={14} />,
  condition: <GitBranch size={14} />,
  artifact: <FileOutput size={14} />,
  delay: <Timer size={14} />,
  merge: <Merge size={14} />,
};

const NODE_COLORS: Record<ProcessNodeType, string> = {
  ignition: "#10b981",
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
  agentId?: string;
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
  const color = NODE_COLORS[nodeType] ?? "#6b7280";
  const isIgnition = nodeType === "ignition";
  const isCondition = nodeType === "condition";
  const isMerge = nodeType === "merge";
  const agent = useAgentStore((s) =>
    data.agentId ? s.agents.find((a) => a.agent_id === data.agentId) : undefined,
  );

  return (
    <div
      style={{
        background: "var(--color-bg, #0d0d1a)",
        border: `1px solid ${selected ? color : "var(--color-border)"}`,
        borderRadius: 0,
        padding: "0 12px",
        height: "var(--control-height-sm, 32px)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minWidth: 140,
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

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {agent && (
          <Avatar avatarUrl={agent.icon ?? undefined} name={agent.name} type="agent" size={20} />
        )}
        <div
          style={{
            width: 20, height: 20,
            background: "transparent", color,
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
                fontSize: 13, fontWeight: 600, color: "var(--color-text, #eee)", lineHeight: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {data.label}
            </div>
          )}
        </div>
      </div>

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
