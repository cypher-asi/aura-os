import { useState } from "react";
import type { ToolCallEntry } from "../../types/stream";
import { TOOL_LABELS, FILE_OPS } from "../../constants/tools";
import { summarizeInput, formatResult } from "../../utils/format";
import { FilePreviewCard } from "../FilePreviewCard";
import { SpecPreviewCard } from "./SpecPreviewCard";
import { TaskCreatedIndicator } from "./TaskCreatedIndicator";
import toolStyles from "../ToolCallBlock.module.css";

export function ToolCallBlock({
  entry,
  defaultExpanded,
}: {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}) {
  const isSpec = entry.name === "create_spec";
  const isTask = entry.name === "create_task";
  const autoExpand = defaultExpanded ?? (isSpec && !entry.started);
  const [expanded, setExpanded] = useState(autoExpand);
  const label = TOOL_LABELS[entry.name] || entry.name;
  const inputSummary = entry.started ? "" : summarizeInput(entry.name, entry.input);
  const isFileOp = FILE_OPS.has(entry.name);

  const stateClass = entry.pending
    ? toolStyles.taskActive
    : entry.isError
      ? toolStyles.taskError
      : toolStyles.taskDone;

  const renderBody = () => {
    if (entry.started) {
      return (
        <div className={toolStyles.toolBodyWrap} style={{ maxHeight: 28, overflow: "hidden" }}>
          <div className={toolStyles.toolBody}>
            <span style={{ fontSize: 11, color: "var(--color-text-muted, #888)" }}>
              Generating…
            </span>
          </div>
        </div>
      );
    }
    if (isFileOp) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${expanded ? toolStyles.toolBodyExpanded : ""}`}>
          <div className={toolStyles.toolBody}>
            <FilePreviewCard entry={entry} />
          </div>
        </div>
      );
    }
    if (isSpec) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${expanded ? toolStyles.toolBodyExpanded : ""}`}>
          <div className={toolStyles.toolBody}>
            <SpecPreviewCard entry={entry} />
          </div>
        </div>
      );
    }
    if (isTask) {
      return (
        <div className={toolStyles.toolBodyWrap} style={{ maxHeight: "none" }}>
          <div className={toolStyles.toolBody}>
            <TaskCreatedIndicator entry={entry} />
          </div>
        </div>
      );
    }
    return (
      <div className={`${toolStyles.toolBodyWrap} ${expanded ? toolStyles.toolBodyExpanded : ""}`}>
        <div className={toolStyles.toolBody}>
          <div className={toolStyles.section}>
            <div className={toolStyles.sectionLabel}>Input</div>
            <pre className={toolStyles.json}>
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </div>
          {entry.result != null && (
            <div className={toolStyles.section}>
              <div className={toolStyles.sectionLabel}>
                {entry.isError ? "Error" : "Result"}
              </div>
              <pre className={`${toolStyles.json} ${entry.isError ? toolStyles.errorText : ""}`}>
                {formatResult(entry.result)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`${toolStyles.toolBlock} ${stateClass}`}>
      <button
        className={toolStyles.toolHeader}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className={toolStyles.taskCheck} />
        <span className={toolStyles.toolName}>{label}</span>
        {inputSummary && (
          <span className={toolStyles.toolSummary}>{inputSummary}</span>
        )}
      </button>
      {renderBody()}
    </div>
  );
}

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
    const label = TOOL_LABELS[dominantName!] || dominantName!;
    if (allDone) {
      return <><strong>{total}</strong> {label.toLowerCase()} actions completed</>;
    }
    return <>{label}: <strong>{doneCount}</strong> of <strong>{total}</strong> completed...</>;
  };

  return (
    <div className={toolStyles.toolCallsContainer}>
      <div className={toolStyles.toolCallsHeader}>
        <span className={`${toolStyles.headerDot} ${allDone ? toolStyles.headerDotDone : ""}`} />
        <span className={toolStyles.headerText}>
          {isBatch ? (
            batchLabel()
          ) : allDone ? (
            <>Ran <strong>{total}</strong> {total === 1 ? "action" : "actions"}</>
          ) : (
            <><strong>Working</strong> on {total} to-do{total !== 1 ? "s" : ""}</>
          )}
        </span>
      </div>
      {isBatch && !showAll ? (
        <button
          type="button"
          className={toolStyles.toolHeader}
          onClick={() => setShowAll(true)}
          style={{ paddingLeft: 18, opacity: 0.7 }}
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
