import { useCallback, useEffect, useRef, useState } from "react";

const COLLAPSE_ANIM_MS = 120;

type BodyPhase = "open" | "closing" | "closed";
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

function renderGenericBody(entry: ToolCallEntry, pendingMessage?: string, closingClass = "") {
  return (
    <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded} ${closingClass}`}>
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
  const isCommand = COMMAND_OPS.has(entry.name);
  const autoExpand = isFileOp || isCommand ? false : (defaultExpanded ?? (isSpec && !entry.pending && !entry.started));
  const [phase, setPhase] = useState<BodyPhase>(autoExpand ? "open" : "closed");
  const closeTimerRef = useRef<number | null>(null);
  const wasPendingRef = useRef(entry.pending);
  const label = TOOL_LABELS[entry.name] || entry.name;
  const expanded = phase === "open";
  const bodyMounted = phase !== "closed";
  const isClosing = phase === "closing";
  const inputSummary = (entry.started && (isSpec || isTask)) ? "" : summarizeInput(entry.name, entry.input);

  const openBody = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setPhase("open");
  }, []);

  const closeBody = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    setPhase((p) => (p === "open" ? "closing" : p));
    closeTimerRef.current = window.setTimeout(() => {
      setPhase("closed");
      closeTimerRef.current = null;
    }, COLLAPSE_ANIM_MS);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (wasPendingRef.current && !entry.pending) {
      closeBody();
    }
    wasPendingRef.current = entry.pending;
  }, [entry.pending, closeBody]);

  const stateClass = entry.pending
    ? toolStyles.taskActive
    : entry.isError
      ? toolStyles.taskError
      : toolStyles.taskDone;

  const hasPartialContent = isSpec && typeof entry.input.markdown_contents === "string" && entry.input.markdown_contents !== "";
  const hasSpecTitle = isSpec && typeof entry.input.title === "string" && (entry.input.title as string).length > 0;
  const showGeneratingHint = entry.pending && !hasPartialContent;

  const closingClass = isClosing ? toolStyles.toolBodyCollapsing : "";

  const renderBody = () => {
    if (entry.pending) {
      if (isSpec && (hasPartialContent || hasSpecTitle)) {
        return (
          <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded}`}>
            <div className={toolStyles.toolBody}>
              <SpecPreviewCard entry={entry} />
            </div>
          </div>
        );
      }
      if (!bodyMounted) return null;
      return renderGenericBody(entry, "Waiting for the tool result.", closingClass);
    }
    if (isTask) {
      if (!bodyMounted) return null;
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded} ${toolStyles.noMaxHeight} ${closingClass}`}>
          <div className={toolStyles.toolBody}>
            <TaskCreatedIndicator entry={entry} />
          </div>
        </div>
      );
    }
    if (!bodyMounted) return null;
    if (isFileOp) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded} ${closingClass}`}>
          <div className={toolStyles.toolBody}>
            <FilePreviewCard entry={entry} />
          </div>
        </div>
      );
    }
    if (isCommand) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded} ${closingClass}`}>
          <div className={toolStyles.toolBody}>
            <CommandPreviewCard entry={entry} />
          </div>
        </div>
      );
    }
    if (isSpec) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded} ${closingClass}`}>
          <div className={toolStyles.toolBody}>
            <SpecPreviewCard entry={entry} />
          </div>
        </div>
      );
    }
    const SuperAgentCard = getSuperAgentCardRenderer(entry.name);
    if (SuperAgentCard && !entry.pending && entry.result) {
      return (
        <div className={`${toolStyles.toolBodyWrap} ${toolStyles.toolBodyExpanded} ${closingClass}`}>
          <div className={toolStyles.toolBody}>
            <SuperAgentCard entry={entry} />
          </div>
        </div>
      );
    }
    return renderGenericBody(entry, undefined, closingClass);
  };

  return (
    <div className={`${toolStyles.toolBlock} ${stateClass}`}>
      <button
        className={toolStyles.toolHeader}
        onClick={() => (expanded ? closeBody() : openBody())}
        type="button"
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
