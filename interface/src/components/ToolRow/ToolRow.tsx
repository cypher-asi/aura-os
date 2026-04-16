import { useCallback, useState } from "react";

import { Check, ChevronRight } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import { TOOL_LABELS, FILE_OPS, COMMAND_OPS } from "../../constants/tools";
import { summarizeInput, formatResult, summarizeError } from "../../utils/format";
import { FilePreviewCard } from "../FilePreviewCard";
import { CommandPreviewCard } from "./CommandPreviewCard";
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
    <>
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
    </>
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
  const isCommand = COMMAND_OPS.has(entry.name);
  // Note: for pending file/command tools the body is force-rendered below
  // regardless of `expanded` (to show the live preview card), so we can keep
  // the initial expanded flag consistent with specs for the non-forced case.
  const initialExpanded = isFileOp || isCommand
    ? (defaultExpanded ?? false)
    : (defaultExpanded ?? (isSpec && !entry.pending && !entry.started));
  const [expanded, setExpanded] = useState(initialExpanded);
  const label = TOOL_LABELS[entry.name] || entry.name;
  const hasTaskTitle = isTask && typeof entry.input.title === "string" && (entry.input.title as string).length > 0;
  const inputSummary = entry.started && isSpec ? "" : summarizeInput(entry.name, entry.input);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const stateClass = entry.pending
    ? toolStyles.taskActive
    : entry.isError
      ? toolStyles.taskError
      : toolStyles.taskDone;

  const hasPartialContent = isSpec && typeof entry.input.markdown_contents === "string" && entry.input.markdown_contents !== "";
  const hasFilePath = isFileOp && typeof entry.input.path === "string" && (entry.input.path as string).length > 0;
  const showGeneratingHint = entry.pending && !hasPartialContent && !hasFilePath && !hasTaskTitle;

  const SuperAgentCard = getSuperAgentCardRenderer(entry.name);

  // Body stays mounted at all times; collapse/expand is done purely via a
  // CSS grid-template-rows transition on `.toolBodyWrap`. This lets the
  // ResizeObserver-driven pin-to-bottom correction track the height change
  // frame-by-frame during the transition, avoiding the one-frame shrink
  // that previously produced a visible upward blink.
  const renderInnerBody = () => {
    if (entry.pending) {
      if (isSpec) return <SpecPreviewCard entry={entry} />;
      if (isFileOp) return <FilePreviewCard entry={entry} />;
      return renderGenericBody(entry, "Waiting for the tool result.");
    }
    if (isTask) {
      return <TaskCreatedIndicator entry={entry} />;
    }
    if (isFileOp) return <FilePreviewCard entry={entry} />;
    if (isCommand) return <CommandPreviewCard entry={entry} />;
    if (isSpec) return <SpecPreviewCard entry={entry} />;
    if (SuperAgentCard && entry.result) {
      return <SuperAgentCard entry={entry} />;
    }
    return renderGenericBody(entry);
  };

  // Certain pending live-previews (spec / file-op) must be visible regardless
  // of the user's current expanded state so the streaming UX isn't broken.
  // Once the tool completes, the regular expanded toggle takes over.
  const forceBodyVisible = entry.pending && (isSpec || isFileOp);
  const bodyVisible = forceBodyVisible || expanded;
  const isTaskBody = isTask && !entry.pending;

  const wrapClass = [
    toolStyles.toolBodyWrap,
    bodyVisible ? toolStyles.toolBodyExpanded : "",
    isTaskBody ? toolStyles.noMaxHeight : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`${toolStyles.toolBlock} ${stateClass}`}>
      <button
        className={toolStyles.toolHeader}
        onClick={toggle}
        type="button"
        aria-expanded={bodyVisible}
      >
        <span className={toolStyles.taskCheck}>
          {!entry.pending && !entry.isError && <Check size={12} strokeWidth={2.5} />}
        </span>
        <span className={toolStyles.toolName}>{label}</span>
        {entry.isError && entry.result ? (
          <span className={toolStyles.headerErrorText}>
            {summarizeError(entry.result)}
          </span>
        ) : showGeneratingHint ? (
          <span className={toolStyles.generatingHint}>Generating…</span>
        ) : inputSummary ? (
          <span className={toolStyles.toolSummary}>{inputSummary}</span>
        ) : null}
        <span className={`${toolStyles.toolChevron} ${bodyVisible ? toolStyles.toolChevronExpanded : ""}`}>
          <ChevronRight size={12} />
        </span>
      </button>
      <div className={wrapClass} aria-hidden={!bodyVisible}>
        <div className={toolStyles.toolBody}>
          {renderInnerBody()}
        </div>
      </div>
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
