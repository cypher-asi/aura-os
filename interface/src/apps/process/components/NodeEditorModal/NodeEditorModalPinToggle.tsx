import { Pin, PinOff } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { NodeEditorEditField } from "./node-editor-modal-edit-field";

interface NodeEditorModalPinToggleProps {
  isPinned: boolean;
  pinLoading: boolean;
  onPinClick: () => void;
}

export function NodeEditorModalPinToggle({ isPinned, pinLoading, onPinClick }: NodeEditorModalPinToggleProps) {
  const pinButtonLabel = isPinned ? "Unpin" : "Pin";
  return (
    <NodeEditorEditField label="Pin Output">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={onPinClick}
          disabled={pinLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid",
            borderColor: isPinned ? "#f59e0b40" : "var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: isPinned ? "rgba(245,158,11,0.1)" : "var(--color-bg-input)",
            color: isPinned ? "#f59e0b" : "var(--color-text-muted)",
            cursor: "pointer",
            transition: "background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease",
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              visibility: "hidden",
              pointerEvents: "none",
            }}
          >
            <PinOff size={13} />
            Unpin
          </span>
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            {pinButtonLabel}
          </span>
        </button>
        <Text variant="secondary" size="xs">
          {isPinned
            ? "Output is pinned. Node will skip execution and replay this output."
            : "Pin the latest output so this node skips execution on re-runs."}
        </Text>
      </div>
    </NodeEditorEditField>
  );
}
