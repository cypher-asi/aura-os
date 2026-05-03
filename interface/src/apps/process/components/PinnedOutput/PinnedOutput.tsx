import { useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Pin, PinOff, ChevronDown, ChevronUp } from "lucide-react";
import type { ProcessNode } from "../../../../shared/types";
import { processApi } from "../../../../shared/api/process";
import { useProcessStore } from "../../stores/process-store";
import { formatOutputContent } from "../NodeOutputTab/node-output-utils";
import { SegmentedContent } from "../../../../components/SegmentedContent";
import styles from "../../../../components/Preview/Preview.module.css";
import mdStyles from "../../../chat/components/MessageBubble/MessageBubble.module.css";

const PIN_TRUNCATE = 400;

export function PinnedOutputField({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > PIN_TRUNCATE;
  const display =
    !expanded && needsTruncation ? text.slice(0, PIN_TRUNCATE) + "\u2026" : text;

  const formatted = useMemo(() => formatOutputContent(display), [display]);

  return (
    <div className={styles.taskField}>
      <span
        className={styles.fieldLabel}
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        <Pin size={11} style={{ color: "var(--color-warning)" }} />
        Pinned Output
        <span
          style={{
            fontSize: 10,
            color: "var(--color-text-muted)",
            fontWeight: 400,
          }}
        >
          &mdash; this is what downstream nodes receive
        </span>
      </span>
      <div
        style={{
          maxHeight: expanded ? "none" : 200,
          overflow: "auto",
          borderLeft: "2px solid color-mix(in srgb, var(--color-warning) 25%, transparent)",
          padding: "4px 8px",
        }}
        className={mdStyles.markdown}
      >
        <SegmentedContent content={formatted} />
      </div>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
            marginTop: 4,
          fontSize: 11,
          color: "var(--color-node-running)",
          cursor: "pointer",
          }}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded
            ? "Show less"
            : `Show more (${(text.length / 1024).toFixed(1)} KB)`}
        </button>
      )}
    </div>
  );
}

export function PinOutputButton({
  node,
  output,
}: {
  node: ProcessNode;
  output: string;
}) {
  const { processId } = useParams<{ processId: string }>();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const isPinned = !!node.config?.pinned_output;
  const [busy, setBusy] = useState(false);

  const handleToggle = useCallback(async () => {
    if (!processId || busy) return;
    setBusy(true);
    try {
      const newConfig = { ...node.config };
      if (isPinned) {
        delete newConfig.pinned_output;
      } else {
        newConfig.pinned_output = output;
      }
      await processApi.updateNode(processId, node.node_id, {
        config: newConfig,
      });
      await fetchNodes(processId);
    } finally {
      setBusy(false);
    }
  }, [processId, node, output, isPinned, busy, fetchNodes]);

  return (
    <button
      onClick={handleToggle}
      disabled={busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 600,
        border: isPinned
          ? "1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)"
          : "1px solid var(--color-border)",
        borderRadius: 0,
        background: isPinned ? "color-mix(in srgb, var(--color-warning) 10%, transparent)" : "transparent",
        color: isPinned ? "var(--color-warning)" : "var(--color-text-muted)",
        cursor: busy ? "wait" : "pointer",
        transition: "all 0.15s",
      }}
    >
      {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
      {isPinned ? "Unpin Output" : "Pin Output"}
    </button>
  );
}
