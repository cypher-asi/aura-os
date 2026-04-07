import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import { TOOL_LABELS, FILE_OPS } from "../../constants/tools";
import { summarizeInput, formatResult } from "../../utils/format";
import { FilePreviewCard } from "../FilePreviewCard";
import { SpecPreviewCard } from "./SpecPreviewCard";
import { getSuperAgentCardRenderer } from "./SuperAgentToolCards";
import { TaskCreatedIndicator } from "./TaskCreatedIndicator";
import toolStyles from "./ToolCallBlock.module.css";

function buildInputDisplay(entry: ToolCallEntry): Record<string, unknown> {
  const explicitInput = entry.input ?? {};
  const hasExplicitKeys = Object.keys(explicitInput).length > 0;

  return {
    explicitInput,
    resolvedInput: explicitInput,
    resolvedContext: {
      toolCallId: entry.id,
      toolName: entry.name,
      resolution: hasExplicitKeys ? "explicit_only" : "implicit_defaults_possible",
    },
    ...(hasExplicitKeys
      ? {}
      : {
        notes: [
          "No explicit arguments were provided by the model.",
          "Runtime defaults and ambient context may still have been applied.",
        ],
      }),
  };
}

function renderGenericBody(entry: ToolCallEntry, pendingMessage?: string) {
  return (
    <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded}`}>
      <div className={toolStyles.toolBody}>
        <div className={toolStyles.section}>
          <div className={toolStyles.sectionLabel}>Input</div>
          <pre className={toolStyles.json}>
            {JSON.stringify(buildInputDisplay(entry), null, 2)}
          </pre>
        </div>
        {pendingMessage ? (
          <div className={toolStyles.section}>
            <div className={toolStyles.sectionLabel}>Status</div>
            <pre className={toolStyles.json}>{pendingMessage}</pre>
          </div>
        ) : entry.result != null ? (
          <div className={toolStyles.section}>
            <div className={toolStyles.sectionLabel}>
              {entry.isError ? "Error" : "Result"}
            </div>
            <pre className={`${toolStyles.json} ${entry.isError ? toolStyles.errorText : ""}`}>
              {formatResult(entry.result)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ToolCallBlock({
  entry,
  defaultExpanded,
}: {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}) {
  const isSpec = entry.name === "create_spec" || entry.name === "update_spec";
  const isTask = entry.name === "create_task";
  const isFileOp = FILE_OPS.has(entry.name);
  const autoExpand = isFileOp ? false : (defaultExpanded ?? (isSpec && !entry.pending && !entry.started));
  const [expanded, setExpanded] = useState(autoExpand);
  const wasPendingRef = useRef(entry.pending);
  const label = TOOL_LABELS[entry.name] || entry.name;
  const inputSummary = (entry.started && !isTask) ? "" : summarizeInput(entry.name, entry.input);

  useEffect(() => {
    if (wasPendingRef.current && !entry.pending) {
      setExpanded(false);
    }
    wasPendingRef.current = entry.pending;
  }, [entry.pending]);

  const stateClass = entry.pending
    ? toolStyles.taskActive
    : entry.isError
      ? toolStyles.taskError
      : toolStyles.taskDone;

  const hasPartialContent = isSpec && typeof entry.input.markdown_contents === "string" && entry.input.markdown_contents !== "";
  const showGeneratingHint = entry.pending && !hasPartialContent;

  const renderBody = () => {
    if (entry.pending) {
      if (hasPartialContent) {
        return (
          <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded}`}>
            <div className={toolStyles.toolBody}>
              <SpecPreviewCard entry={entry} />
            </div>
          </div>
        );
      }
      if (!expanded) return null;
      return renderGenericBody(entry, "Waiting for the tool result.");
    }
    if (isTask) {
      if (!expanded) return null;
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded} ${toolStyles.noMaxHeight}`}>
          <div className={toolStyles.toolBody}>
            <TaskCreatedIndicator entry={entry} />
          </div>
        </div>
      );
    }
    if (!expanded) return null;
    if (isFileOp) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded}`}>
          <div className={toolStyles.toolBody}>
            <FilePreviewCard entry={entry} />
          </div>
        </div>
      );
    }
    if (isSpec) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded}`}>
          <div className={toolStyles.toolBody}>
            <SpecPreviewCard entry={entry} />
          </div>
        </div>
      );
    }
    const SuperAgentCard = getSuperAgentCardRenderer(entry.name);
    if (SuperAgentCard && !entry.pending && entry.result) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded}`}>
          <div className={toolStyles.toolBody}>
            <SuperAgentCard entry={entry} />
          </div>
        </div>
      );
    }
    return renderGenericBody(entry);
  };

  return (
    <div className={`${toolStyles.toolBlock} ${stateClass}`}>
      <button
        className={toolStyles.toolHeader}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className={toolStyles.taskCheck}>
          {!entry.pending && !entry.isError && <Check size={12} strokeWidth={2.5} />}
        </span>
        <span className={toolStyles.toolName}>{label}</span>
        {entry.isError && entry.result ? (
          <span className={toolStyles.headerErrorText}>
            {entry.result.length > 100 ? entry.result.slice(0, 100) + "…" : entry.result}
          </span>
        ) : showGeneratingHint ? (
          <span className={toolStyles.generatingHint}>Generating…</span>
        ) : inputSummary ? (
          <span className={toolStyles.toolSummary}>{inputSummary}</span>
        ) : null}
        <span className={`${toolStyles.toolChevron} ${expanded ? toolStyles.toolChevronExpanded : ""}`}>
          <ChevronRight size={12} />
        </span>
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
    const label = (TOOL_LABELS[dominantName ?? ""] || dominantName) ?? "";
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
