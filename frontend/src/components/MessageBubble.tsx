import { useState, useRef, useEffect, memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { FileText } from "lucide-react";
import type { ToolCallEntry, ArtifactRef } from "../hooks/use-chat-stream";
import styles from "./ChatView.module.css";
import toolStyles from "./ToolCallBlock.module.css";
import { ResponseBlock } from "./ResponseBlock";
import { CookingIndicator, getStreamingPhaseLabel } from "./CookingIndicator";
import { FilePreviewCard } from "./FilePreviewCard";

import type { DisplayContentBlockUnion } from "../hooks/use-chat-stream";

function stripEmojis(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/ {2,}/g, " ");
}

/** Collapse accidental paragraph breaks and fix table-breaking blank lines so markdown renders consistently. */
function normalizeMidSentenceBreaks(text: string): string {
  return text.replace(/\n\n+/g, (match, offset) => {
    const before = text.slice(0, offset).split("\n");
    const after = text.slice(offset + match.length).split("\n");

    const lastLine = before[before.length - 1]?.trim() ?? "";
    const nextLine = after.find((line) => line.trim().length > 0)?.trim() ?? "";

    // GFM ends a table on a blank line. Between two table rows, keep exactly one newline so the table continues.
    const looksLikeTableRow = (line: string) => /^\|.+\|\s*$/.test(line);
    if (looksLikeTableRow(lastLine) && looksLikeTableRow(nextLine)) {
      return "\n";
    }

    const looksLikeSentenceEnd = /[.!?]\s*$/.test(lastLine);
    const looksLikeMarkdownBlock =
      /^(?:[-*+]\s+|#+\s+|\d+[.)]\s+)/.test(lastLine) ||
      /^(?:[-*+]\s+|#+\s+|\d+[.)]\s+)/.test(nextLine);
    const looksLikeSpecIndex = /^\d{1,3}:\s+/.test(lastLine);
    const looksLikeWrappedSentence =
      /[a-z0-9,]$/i.test(lastLine) && /^[a-z(]/i.test(nextLine);

    if (looksLikeSentenceEnd || looksLikeMarkdownBlock || looksLikeSpecIndex) {
      return match;
    }

    return looksLikeWrappedSentence ? " " : match;
  });
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallEntry[];
  artifactRefs?: ArtifactRef[];
  contentBlocks?: DisplayContentBlockUnion[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
}

interface Props {
  message: DisplayMessage;
}

const TOOL_LABELS: Record<string, string> = {
  list_specs: "List specs",
  get_spec: "Get spec",
  create_spec: "Create spec",
  update_spec: "Update spec",
  delete_spec: "Delete spec",
  list_tasks: "List tasks",
  create_task: "Create task",
  update_task: "Update task",
  delete_task: "Delete task",
  transition_task: "Transition task",
  run_task: "Run task",
  get_project: "Get project",
  update_project: "Update project",
  start_dev_loop: "Start dev loop",
  pause_dev_loop: "Pause dev loop",
  stop_dev_loop: "Stop dev loop",
  read_file: "Read file",
  write_file: "Write file",
  delete_file: "Delete file",
  list_files: "List files",
  get_progress: "Get stats",
};

const FILE_OPS = new Set(["write_file", "edit_file", "read_file"]);
const ARTIFACT_OPS = new Set(["create_task", "create_spec"]);

function ArtifactPreview({ entry }: { entry: ToolCallEntry }) {
  const title = (entry.input.title as string) || "";
  const description = (entry.input.description as string) || (entry.input.markdown_contents as string) || "";
  const firstLine = description.split("\n")[0]?.slice(0, 120) || "";

  return (
    <div style={{ padding: "2px 0 2px 4px", fontSize: 12 }}>
      {title && (
        <div style={{ color: "var(--color-text, #ddd)", fontWeight: 500 }}>
          {title}
        </div>
      )}
      {firstLine && (
        <div style={{ color: "var(--color-text-muted, #888)", fontSize: 11, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {firstLine}
        </div>
      )}
      {entry.isError && entry.result && (
        <div style={{ color: "#f87171", fontSize: 11, marginTop: 2 }}>
          {entry.result.slice(0, 120)}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[entry.name] || entry.name;
  const inputSummary = summarizeInput(entry.name, entry.input);
  const isFileOp = FILE_OPS.has(entry.name);
  const isArtifactOp = ARTIFACT_OPS.has(entry.name);

  const stateClass = entry.pending
    ? toolStyles.taskActive
    : entry.isError
      ? toolStyles.taskError
      : toolStyles.taskDone;

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
      {isFileOp ? (
        <div className={`${toolStyles.toolBodyWrap} ${expanded ? toolStyles.toolBodyExpanded : ""}`}>
          <div className={toolStyles.toolBody}>
            <FilePreviewCard entry={entry} />
          </div>
        </div>
      ) : isArtifactOp ? (
        <div className={`${toolStyles.toolBodyWrap} ${expanded ? toolStyles.toolBodyExpanded : ""}`}>
          <div className={toolStyles.toolBody}>
            <ArtifactPreview entry={entry} />
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}

function ToolCallsList({ entries }: { entries: ToolCallEntry[] }) {
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

function ArtifactRefsList({ refs }: { refs: ArtifactRef[] }) {
  const tasks = refs.filter((r) => r.kind === "task");
  const specs = refs.filter((r) => r.kind === "spec");
  return (
    <div className={toolStyles.artifactRefs}>
      {specs.map((ref) => (
        <div key={ref.id} className={toolStyles.artifactRef}>
          <span className={toolStyles.artifactRefIcon}>spec</span>
          <span className={toolStyles.artifactRefTitle}>{ref.title}</span>
        </div>
      ))}
      {tasks.map((ref) => (
        <div key={ref.id} className={toolStyles.artifactRef}>
          <span className={toolStyles.artifactRefIcon}>task</span>
          <span className={toolStyles.artifactRefTitle}>{ref.title}</span>
        </div>
      ))}
    </div>
  );
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "read_file":
    case "write_file":
    case "delete_file":
      return (input.path as string) || "";
    case "list_files": {
      const path = (input.path as string) || "";
      return path === "." ? "" : path;
    }
    case "create_spec":
    case "create_task":
      return (input.title as string) || "";
    case "get_spec":
      return (input.spec_id as string)?.slice(0, 8) || "";
    case "transition_task":
      return `${(input.task_id as string)?.slice(0, 8)} → ${input.status}`;
    default:
      return "";
  }
}

function formatResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result;
  }
}

const FILE_PREFIX_RE = /^\[File:\s*(.+?)\]\n\n([\s\S]*)$/;

function FileAttachmentBlock({ text }: { text: string }) {
  const match = text.match(FILE_PREFIX_RE);
  if (!match) return <span>{text}</span>;

  return (
    <ResponseBlock
      header={
        <>
          <FileText size={14} className={styles.fileAttachmentIcon} />
          <span className={styles.fileAttachmentName}>{match[1]}</span>
        </>
      }
      contentClassName={styles.fileAttachmentContent}
    >
      <pre>{match[2]}</pre>
    </ResponseBlock>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
}

function ThinkingBlock({ text, isStreaming, durationMs }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const frame = window.requestAnimationFrame(() => setExpanded(false));
      prevStreamingRef.current = isStreaming;
      return () => window.cancelAnimationFrame(frame);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (expanded && isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, expanded, isStreaming]);

  const durationLabel = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  return (
    <ResponseBlock
      expanded={expanded}
      onExpandedChange={setExpanded}
      maxExpandedHeight={300}
      className={styles.thinkingBlock}
      header={
        <span className={`${styles.thinkingLabel} ${isStreaming ? styles.thinkingLabelShimmer : ""}`}>
          {durationLabel}
        </span>
      }
    >
      <div ref={contentRef} className={styles.thinkingContent}>
        {stripEmojis(text)}
      </div>
    </ResponseBlock>
  );
}

export const MessageBubble = memo(function MessageBubble({ message }: Props) {
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasArtifactRefs = message.artifactRefs && message.artifactRefs.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const hasThinking = message.thinkingText && message.thinkingText.length > 0;

  const normalizedContent = useMemo(
    () => (hasContent ? normalizeMidSentenceBreaks(stripEmojis(message.content)) : ""),
    [hasContent, message.content],
  );

  if (!hasContent && !hasToolCalls && !hasContentBlocks && !hasThinking && !hasArtifactRefs) return null;

  const renderUserContent = () => {
    if (hasContentBlocks) {
      return (
        <div className={styles.userMessageBlocks}>
          {message.contentBlocks!.map((block, i) =>
            block.type === "text" ? (
              FILE_PREFIX_RE.test(block.text) ? (
                <FileAttachmentBlock key={i} text={block.text} />
              ) : (
                <span key={i}>{block.text}</span>
              )
            ) : (
              <img
                key={i}
                src={`data:${block.media_type};base64,${block.data}`}
                alt=""
                className={styles.messageImage}
              />
            ),
          )}
        </div>
      );
    }
    return message.content;
  };

  return (
    <div
      className={`${styles.message} ${
        message.role === "user" ? styles.messageUser : styles.messageAssistant
      }`}
    >
      <div
        className={`${styles.bubble} ${
          message.role === "user" ? styles.bubbleUser : styles.bubbleAssistant
        }`}
      >
        {message.role === "user" ? (
          renderUserContent()
        ) : (
          <div className={styles.markdown}>
            {hasThinking && (
              <ThinkingBlock
                text={message.thinkingText!}
                isStreaming={false}
                durationMs={message.thinkingDurationMs}
              />
            )}
            {hasToolCalls && (
              <ToolCallsList entries={message.toolCalls!} />
            )}
            {hasArtifactRefs && (
              <ArtifactRefsList refs={message.artifactRefs!} />
            )}
            {hasContent && (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeHighlight]}
              >
                {normalizedContent}
              </ReactMarkdown>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

interface StreamingBubbleProps {
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  progressText?: string;
}

function StreamingIndicator({
  text,
  thinkingText,
  toolCalls,
  progressText,
}: {
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
  progressText?: string;
}) {
  const label = getStreamingPhaseLabel({
    streamingText: text,
    thinkingText,
    toolCalls: toolCalls ?? [],
    progressText,
  });

  return <CookingIndicator label={label ?? "Cooking..."} />;
}

export function StreamingBubble({ text, toolCalls, thinkingText, thinkingDurationMs, progressText }: StreamingBubbleProps) {
  const isThinking = Boolean(thinkingText) && !text;
  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <div className={styles.markdown}>
          {thinkingText && (
            <ThinkingBlock
              text={thinkingText}
              isStreaming={isThinking}
              durationMs={thinkingDurationMs}
            />
          )}
          {toolCalls && toolCalls.length > 0 && (
            <ToolCallsList entries={toolCalls} />
          )}
          {text && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={[rehypeHighlight]}
            >
              {normalizeMidSentenceBreaks(stripEmojis(text))}
            </ReactMarkdown>
          )}
          <StreamingIndicator text={text} thinkingText={thinkingText} toolCalls={toolCalls} progressText={progressText} />
        </div>
      </div>
    </div>
  );
}
