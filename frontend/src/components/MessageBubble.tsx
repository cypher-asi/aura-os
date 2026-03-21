import { useState, useRef, useEffect, memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { FileText, Plus, CheckCircle2, XCircle, Search, Terminal, Trash2, FolderOpen, Wrench } from "lucide-react";
import type { ToolCallEntry, ArtifactRef, DisplayContentBlockUnion, DisplayMessage } from "../types/stream";
import styles from "./ChatView.module.css";
import toolStyles from "./ToolCallBlock.module.css";
import fileStyles from "./FilePreviewCard.module.css";
import { ResponseBlock } from "./ResponseBlock";
import { CookingIndicator, getStreamingPhaseLabel } from "./CookingIndicator";
import { FilePreviewCard } from "./FilePreviewCard";

/**
 * Split text into alternating prose / fenced-code segments so that
 * text-processing helpers can leave code blocks untouched.
 */
function splitByCodeFences(text: string): { content: string; isCode: boolean }[] {
  const segments: { content: string; isCode: boolean }[] = [];
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/gm;
  let cursor = 0;
  let insideCode = false;
  let openFenceChar = "";
  let openFenceLen = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) {
    const fenceChar = match[1][0];
    const fenceLen = match[1].length;

    if (!insideCode) {
      if (match.index > cursor) {
        segments.push({ content: text.slice(cursor, match.index), isCode: false });
      }
      cursor = match.index;
      insideCode = true;
      openFenceChar = fenceChar;
      openFenceLen = fenceLen;
    } else if (fenceChar === openFenceChar && fenceLen >= openFenceLen) {
      const lineEnd = text.indexOf("\n", match.index);
      const blockEnd = lineEnd === -1 ? text.length : lineEnd + 1;
      segments.push({ content: text.slice(cursor, blockEnd), isCode: true });
      cursor = blockEnd;
      insideCode = false;
    }
  }

  if (cursor < text.length) {
    segments.push({ content: text.slice(cursor), isCode: insideCode });
  }

  return segments;
}

function stripEmojis(text: string): string {
  return splitByCodeFences(text)
    .map((seg) =>
      seg.isCode
        ? seg.content
        : seg.content
            .replace(/\p{Extended_Pictographic}/gu, "")
            .replace(/ {2,}/g, " "),
    )
    .join("");
}

/** Collapse accidental paragraph breaks in prose, preserving code blocks. */
function normalizeProseBreaks(prose: string): string {
  return prose.replace(/\n\n+/g, (match, offset) => {
    const before = prose.slice(0, offset).split("\n");
    const after = prose.slice(offset + match.length).split("\n");

    const lastLine = before[before.length - 1]?.trim() ?? "";
    const nextLine = after.find((line) => line.trim().length > 0)?.trim() ?? "";

    const looksLikeTableRow = (line: string) => /^\|.+\|\s*$/.test(line);
    if (looksLikeTableRow(lastLine) && looksLikeTableRow(nextLine)) {
      return "\n";
    }

    const looksLikeSentenceEnd = /[.!?:]\s*$/.test(lastLine);
    const looksLikeMarkdownBlock =
      /^(?:[-*+]\s+|#+\s+|\d+[.)]\s+)/.test(lastLine) ||
      /^(?:[-*+]\s+|#+\s+|\d+[.)]\s+)/.test(nextLine);
    const looksLikeSpecIndex = /^\d{1,3}:\s+/.test(lastLine);
    const looksLikeWrappedSentence =
      /[a-z,]$/.test(lastLine) && /^[a-z]/.test(nextLine);

    if (looksLikeSentenceEnd || looksLikeMarkdownBlock || looksLikeSpecIndex) {
      return match;
    }

    return looksLikeWrappedSentence ? " " : match;
  });
}

function normalizeMidSentenceBreaks(text: string): string {
  return splitByCodeFences(text)
    .map((seg) => (seg.isCode ? seg.content : normalizeProseBreaks(seg.content)))
    .join("");
}

// ---------------------------------------------------------------------------
// Inline tool-marker parsing: [tool: name(arg) -> ok|error] and [auto-build: ...]
// Handles both ASCII -> and Unicode → arrow variants.
// ---------------------------------------------------------------------------

type ContentSegment =
  | { kind: "text"; content: string }
  | { kind: "tool"; name: string; arg?: string; status: "ok" | "error" }
  | { kind: "auto-build"; command: string };

const INLINE_MARKER_RE =
  /\[tool:\s*(\S+?)(?:\(([^)]*)\))?\s*(?:->|→)\s*(ok|error)\]|\[auto-build:\s*([^\]]+)\]/g;

function splitContentByMarkers(text: string): ContentSegment[] | null {
  INLINE_MARKER_RE.lastIndex = 0;
  const first = INLINE_MARKER_RE.exec(text);
  if (!first) return null;

  INLINE_MARKER_RE.lastIndex = 0;
  const segments: ContentSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_MARKER_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      const prose = text.slice(cursor, match.index).trim();
      if (prose) segments.push({ kind: "text", content: prose });
    }
    if (match[4] !== undefined) {
      segments.push({ kind: "auto-build", command: match[4].trim() });
    } else {
      segments.push({
        kind: "tool",
        name: match[1],
        arg: match[2] || undefined,
        status: match[3] as "ok" | "error",
      });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    const prose = text.slice(cursor).trim();
    if (prose) segments.push({ kind: "text", content: prose });
  }

  return segments.length > 0 ? segments : null;
}

function inlineToolIcon(name: string) {
  const size = 12;
  switch (name) {
    case "read_file": return <FileText size={size} />;
    case "write_file":
    case "edit_file": return <FileText size={size} />;
    case "delete_file": return <Trash2 size={size} />;
    case "list_files": return <FolderOpen size={size} />;
    case "search_code": return <Search size={size} />;
    case "run_command": return <Terminal size={size} />;
    default: return <Wrench size={size} />;
  }
}

function shortenArg(arg: string, max: number): string {
  return arg.length <= max ? arg : arg.slice(0, max - 1) + "\u2026";
}

function inlineToolLabel(name: string, arg?: string): string {
  const short = arg ? shortenArg(arg, 60) : "";
  switch (name) {
    case "read_file": return short ? `Read \`${short}\`` : "Read file";
    case "write_file": return short ? `Write \`${short}\`` : "Write file";
    case "edit_file": return short ? `Edit \`${short}\`` : "Edit file";
    case "delete_file": return short ? `Delete \`${short}\`` : "Delete file";
    case "list_files": return short ? `List \`${short}\`` : "List files";
    case "search_code": return short ? `Search: ${short}` : "Search code";
    case "run_command": return short ? `Run: \`${short}\`` : "Run command";
    default: return short ? `${name}: ${short}` : `Tool: ${name}`;
  }
}

function InlineToolMarker({ seg }: { seg: Extract<ContentSegment, { kind: "tool" }> }) {
  const isError = seg.status === "error";
  return (
    <div className={styles.inlineToolMarker} data-status={seg.status}>
      <span className={styles.inlineToolIcon}>{inlineToolIcon(seg.name)}</span>
      <span className={styles.inlineToolLabel}>{inlineToolLabel(seg.name, seg.arg)}</span>
      <span className={`${styles.inlineToolStatus} ${isError ? styles.inlineToolError : styles.inlineToolOk}`}>
        {isError ? <XCircle size={10} /> : <CheckCircle2 size={10} />}
        {seg.status}
      </span>
    </div>
  );
}

function InlineAutoBuildMarker({ seg }: { seg: Extract<ContentSegment, { kind: "auto-build" }> }) {
  return (
    <div className={styles.inlineToolMarker} data-status="build">
      <span className={styles.inlineToolIcon}><Terminal size={12} /></span>
      <span className={styles.inlineToolLabel}>Build: <code>{seg.command}</code></span>
    </div>
  );
}

function SegmentedContent({
  content,
  remarkPlugins,
  rehypePlugins,
}: {
  content: string;
  remarkPlugins: Parameters<typeof ReactMarkdown>[0]["remarkPlugins"];
  rehypePlugins: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"];
}) {
  const segments = useMemo(() => splitContentByMarkers(content), [content]);

  if (!segments) {
    return (
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {content}
      </ReactMarkdown>
    );
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <ReactMarkdown key={i} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
              {seg.content}
            </ReactMarkdown>
          );
        }
        if (seg.kind === "auto-build") {
          return <InlineAutoBuildMarker key={i} seg={seg} />;
        }
        return <InlineToolMarker key={i} seg={seg} />;
      })}
    </>
  );
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

const COLLAPSED_SPEC_LINES = 20;

function SpecPreviewCard({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const title = (entry.input.title as string) || "Untitled spec";
  const content = (entry.input.markdown_contents as string) || "";
  const lines = content.split("\n");
  const needsCollapse = lines.length > COLLAPSED_SPEC_LINES;
  const displayContent =
    !expanded && needsCollapse
      ? lines.slice(0, COLLAPSED_SPEC_LINES).join("\n")
      : content;

  return (
    <div className={fileStyles.card}>
      <div className={fileStyles.header}>
        <FileText size={14} className={fileStyles.fileIcon} />
        <span className={fileStyles.fileName}>{title}</span>
        <span className={fileStyles.badge}>Spec</span>
      </div>
      <div className={`${fileStyles.codeArea} ${!expanded && needsCollapse ? fileStyles.collapsed : ""}`}>
        <pre>
          <code className="hljs language-markdown">{displayContent}</code>
        </pre>
      </div>
      {needsCollapse && (
        <button
          type="button"
          className={fileStyles.toggleBtn}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
      {entry.isError && entry.result && (
        <div style={{ color: "#f87171", fontSize: 11, padding: "4px 10px" }}>
          {entry.result.slice(0, 200)}
        </div>
      )}
    </div>
  );
}

function TaskCreatedIndicator({ entry }: { entry: ToolCallEntry }) {
  const title = (entry.input.title as string) || "";
  const description = (entry.input.description as string) || "";
  const firstLine = description.split("\n")[0]?.slice(0, 140) || "";

  return (
    <div className={toolStyles.taskIndicator}>
      <div className={toolStyles.taskIndicatorRow}>
        <Plus size={14} className={toolStyles.taskIndicatorIcon} />
        <span className={toolStyles.taskIndicatorLabel}>Task Created</span>
        {title && (
          <span className={toolStyles.taskIndicatorTitle}>{title}</span>
        )}
      </div>
      {firstLine && (
        <div className={toolStyles.taskIndicatorDesc}>{firstLine}</div>
      )}
      {entry.isError && entry.result && (
        <div style={{ color: "#f87171", fontSize: 11, marginTop: 2 }}>
          {entry.result.slice(0, 200)}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ entry }: { entry: ToolCallEntry }) {
  const isSpec = entry.name === "create_spec";
  const isTask = entry.name === "create_task";
  const autoExpand = isSpec && !entry.started;
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
              <SegmentedContent
                content={normalizedContent}
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeHighlight]}
              />
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
            <SegmentedContent
              content={normalizeMidSentenceBreaks(stripEmojis(text))}
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={[rehypeHighlight]}
            />
          )}
          <StreamingIndicator text={text} thinkingText={thinkingText} toolCalls={toolCalls} progressText={progressText} />
        </div>
      </div>
    </div>
  );
}
