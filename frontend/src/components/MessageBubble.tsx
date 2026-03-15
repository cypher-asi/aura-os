import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronRight, Loader2, Wrench, CheckCircle2, XCircle } from "lucide-react";
import type { ToolCallEntry } from "../hooks/use-chat-stream";
import styles from "./ChatView.module.css";
import toolStyles from "./ToolCallBlock.module.css";

import type { DisplayContentBlockUnion } from "../hooks/use-chat-stream";

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
  get_progress: "Get progress",
};

function ToolCallBlock({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[entry.name] || entry.name;

  const inputSummary = summarizeInput(entry.name, entry.input);

  return (
    <div className={toolStyles.toolBlock}>
      <button
        className={toolStyles.toolHeader}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className={toolStyles.toolIcon}>
          {entry.pending ? (
            <Loader2 size={14} className={toolStyles.spinner} />
          ) : entry.isError ? (
            <XCircle size={14} className={toolStyles.errorIcon} />
          ) : (
            <CheckCircle2 size={14} className={toolStyles.successIcon} />
          )}
        </span>
        <Wrench size={12} className={toolStyles.wrenchIcon} />
        <span className={toolStyles.toolName}>{label}</span>
        {inputSummary && (
          <span className={toolStyles.toolSummary}>{inputSummary}</span>
        )}
        <span className={toolStyles.chevron}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
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
              <span key={i}>{block.text}</span>
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
              <div className={toolStyles.toolCallsContainer}>
                {message.toolCalls!.map((tc) => (
                  <ToolCallBlock key={tc.id} entry={tc} />
                ))}
              </div>
            )}
            {hasContent && (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {message.content}
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
}

export function StreamingBubble({ text, toolCalls }: StreamingBubbleProps) {
  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <div className={styles.markdown}>
          {toolCalls && toolCalls.length > 0 && (
            <div className={toolStyles.toolCallsContainer}>
              {toolCalls.map((tc) => (
                <ToolCallBlock key={tc.id} entry={tc} />
              ))}
            </div>
          )}
          {text && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {text}
            </ReactMarkdown>
          )}
          <span className={styles.streamingCursor} />
        </div>
      </div>
    </div>
  );
}
