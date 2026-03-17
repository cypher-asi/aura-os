import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { ToolCallEntry } from "../hooks/use-chat-stream";
import styles from "./ChatView.module.css";
import toolStyles from "./ToolCallBlock.module.css";

import type { DisplayContentBlockUnion } from "../hooks/use-chat-stream";

function stripEmojis(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/ {2,}/g, " ");
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallEntry[];
  contentBlocks?: DisplayContentBlockUnion[];
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
  list_sprints: "List sprints",
  create_sprint: "Create sprint",
  update_sprint: "Update sprint",
  delete_sprint: "Delete sprint",
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

function ToolCallBlock({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[entry.name] || entry.name;
  const inputSummary = summarizeInput(entry.name, entry.input);

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
      {expanded && (
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
      )}
    </div>
  );
}

function ToolCallsList({ entries }: { entries: ToolCallEntry[] }) {
  const pendingCount = entries.filter((e) => e.pending).length;
  const total = entries.length;
  const allDone = pendingCount === 0;

  return (
    <div className={toolStyles.toolCallsContainer}>
      <div className={toolStyles.toolCallsHeader}>
        <span className={`${toolStyles.headerDot} ${allDone ? toolStyles.headerDotDone : ""}`} />
        <span className={toolStyles.headerText}>
          {allDone ? (
            <>Ran <strong>{total}</strong> {total === 1 ? "action" : "actions"}</>
          ) : (
            <><strong>Working</strong> on {total} to-do{total !== 1 ? "s" : ""}</>
          )}
        </span>
      </div>
      {entries.map((tc) => (
        <ToolCallBlock key={tc.id} entry={tc} />
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
    case "list_files":
      return (input.path as string) || ".";
    case "create_spec":
    case "create_task":
    case "create_sprint":
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
  const [expanded, setExpanded] = useState(false);
  const match = text.match(FILE_PREFIX_RE);
  if (!match) return <span>{text}</span>;

  const fileName = match[1];
  const fileContent = match[2];

  return (
    <div className={styles.fileAttachmentBlock}>
      <button
        className={styles.fileAttachmentHeader}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <FileText size={14} className={styles.fileAttachmentIcon} />
        <span className={styles.fileAttachmentName}>{fileName}</span>
        <span className={styles.fileAttachmentChevron}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {expanded && (
        <div className={styles.fileAttachmentContent}>
          <pre>{fileContent}</pre>
        </div>
      )}
    </div>
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
      setExpanded(false);
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
    <div className={styles.thinkingBlock}>
      <button
        className={`${styles.thinkingHeader} ${isStreaming ? styles.thinkingHeaderActive : ""}`}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className={`${styles.thinkingLabel} ${isStreaming ? styles.thinkingLabelShimmer : ""}`}>
          {durationLabel}
        </span>
        <span className={styles.thinkingChevron}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      <div
        className={`${styles.thinkingContentWrap} ${expanded ? styles.thinkingContentExpanded : ""}`}
      >
        <div ref={contentRef} className={styles.thinkingContent}>
          {stripEmojis(text)}
        </div>
      </div>
    </div>
  );
}

export function MessageBubble({ message }: Props) {
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;

  if (!hasContent && !hasToolCalls && !hasContentBlocks) return null;

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
            {hasToolCalls && (
              <ToolCallsList entries={message.toolCalls!} />
            )}
            {hasContent && (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeHighlight]}
              >
                {stripEmojis(message.content)}
              </ReactMarkdown>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface StreamingBubbleProps {
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
}

function StreamingIndicator({
  text,
  thinkingText,
  toolCalls,
}: {
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
}) {
  const hasText = Boolean(text);
  const hasThinking = Boolean(thinkingText);
  const hasPendingTools = toolCalls?.some((tc) => tc.pending) ?? false;

  if (hasText) {
    return <span className={styles.streamingCursorGlow} />;
  }

  if (hasThinking || hasPendingTools) {
    return null;
  }

  return (
    <div className={styles.shimmerPlaceholder}>
      <div className={styles.shimmerBar} />
      <div className={styles.shimmerBar} />
      <div className={styles.shimmerBar} />
    </div>
  );
}

export function CookingIndicator() {
  return (
    <div className={styles.cookingIndicator}>
      <span className={styles.cookingText}>Cooking...</span>
    </div>
  );
}

export function StreamingBubble({ text, toolCalls, thinkingText, thinkingDurationMs }: StreamingBubbleProps) {
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
              {stripEmojis(text)}
            </ReactMarkdown>
          )}
          <StreamingIndicator text={text} thinkingText={thinkingText} toolCalls={toolCalls} />
        </div>
      </div>
    </div>
  );
}
