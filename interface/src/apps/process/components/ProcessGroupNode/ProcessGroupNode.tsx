import { memo, useCallback, useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Layers } from "lucide-react";

interface ProcessGroupNodeData {
  label: string;
  isRenaming?: boolean;
  onRenameSubmit?: (newLabel: string) => void;
  onResizeStop?: (nodeId: string, width?: number, height?: number) => void;
}

function RenameInput({ value, onSubmit }: { value: string; onSubmit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const committedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draftRef.current.trim();
    onSubmit(trimmed || value);
  }, [value, onSubmit]);

  useEffect(() => () => {
    commit();
  }, [commit]);

  return (
    <input
      ref={inputRef}
      className="nodrag nopan process-node-rename-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          committedRef.current = true;
          onSubmit(value);
        }
      }}
    />
  );
}

function ProcessGroupNodeInner({ id, data, selected }: NodeProps & { data: ProcessGroupNodeData }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: selected ? "1px solid #0ea5e9" : "1px solid rgba(148, 163, 184, 0.5)",
        background: "rgba(14, 165, 233, 0.08)",
        boxShadow: selected ? "0 0 0 1px rgba(14, 165, 233, 0.35)" : "none",
        pointerEvents: "all",
        position: "relative",
      }}
    >
      <NodeResizer
        minWidth={220}
        minHeight={150}
        isVisible={selected}
        lineStyle={{ borderColor: "#38bdf8" }}
        handleStyle={{ width: 8, height: 8, borderRadius: 0, background: "#38bdf8" }}
        onResizeEnd={(_, params) => {
          data.onResizeStop?.(
            id,
            typeof params.width === "number" ? params.width : undefined,
            typeof params.height === "number" ? params.height : undefined,
          );
        }}
      />
      <div
        className="nodrag"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          position: "absolute",
          left: 8,
          top: 8,
          padding: "4px 8px",
          background: "rgba(10, 15, 25, 0.72)",
          border: "1px solid rgba(148, 163, 184, 0.4)",
          color: "var(--color-text, #e5e7eb)",
          maxWidth: "calc(100% - 16px)",
        }}
      >
        <Layers size={12} style={{ color: "#38bdf8", flexShrink: 0 }} />
        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>
          {data.isRenaming && data.onRenameSubmit ? (
            <RenameInput value={data.label} onSubmit={data.onRenameSubmit} />
          ) : (
            data.label
          )}
        </div>
      </div>
    </div>
  );
}

export const ProcessGroupNode = memo(ProcessGroupNodeInner);
