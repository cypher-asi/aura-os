import { useState } from "react";

import type { ToolCallEntry } from "../../shared/types/stream";
import { TOOL_LABELS } from "../../constants/tools";
import { renderToolBlock } from "../Block";
import toolStyles from "./ToolCallBlock.module.css";

/**
 * Thin wrapper that dispatches a ToolCallEntry to the Block registry.
 *
 * Historically this component owned all of the per-tool rendering
 * (FilePreview / SpecPreview / CommandPreview / TaskCreatedIndicator /
 * SuperAgentToolCards / generic JSON body) behind one big if/else ladder.
 * That ladder now lives in [Block/registry.tsx](../Block/registry.tsx); this
 * file stays only so timeline/render callers can keep a stable import
 * surface (`ToolCallBlock`, `ToolCallsList`).
 */
export function ToolCallBlock({
  entry,
  defaultExpanded,
}: {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}) {
  return <>{renderToolBlock(entry, defaultExpanded)}</>;
}

/**
 * Wrapper around a batch of tool calls that collapses very long runs of
 * the same tool name (e.g. 30 `list_files` in a row) behind a single
 * "Show all N actions" button. Individual tool rendering is delegated
 * to `ToolCallBlock` so every block shares the same primitive.
 */
export function ToolCallsList({ entries }: { entries: ToolCallEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const pendingCount = entries.filter((e) => e.pending).length;
  const doneCount = entries.length - pendingCount;
  const total = entries.length;
  const allDone = pendingCount === 0;

  const nameCounts = new Map<string, number>();
  for (const e of entries) {
    nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);
  }
  let dominantName: string | null = null;
  for (const [name, count] of nameCounts) {
    if (count / total >= 0.7) {
      dominantName = name;
      break;
    }
  }

  const isBatch = dominantName !== null && total > 3;

  const batchLabel = () => {
    const label = (TOOL_LABELS[dominantName ?? ""] || dominantName) ?? "";
    if (allDone) {
      return <><strong>{total}</strong> {label.toLowerCase()} actions completed</>;
    }
    return <>{label}: <strong>{doneCount}</strong> of <strong>{total}</strong> completed...</>;
  };

  return (
    <div className={toolStyles.toolCallsContainer}>
      <div className={toolStyles.toolCallsHeader}>
        <span className={toolStyles.headerText}>
          {isBatch ? (
            batchLabel()
          ) : allDone ? (
            <>{total} {total === 1 ? "action" : "actions"} completed</>
          ) : (
            <>Working on {total} {total === 1 ? "action" : "actions"}...</>
          )}
        </span>
      </div>
      {isBatch && !showAll ? (
        <button
          type="button"
          className={`${toolStyles.toolHeader} ${toolStyles.showAllButton}`}
          onClick={() => setShowAll(true)}
        >
          Show all {total} actions
        </button>
      ) : (
        entries.map((tc) => (
          <ToolCallBlock key={tc.id} entry={tc} />
        ))
      )}
    </div>
  );
}
