import { ClipboardList, CheckSquare, ArrowRightCircle } from "lucide-react";
import type { ToolCallEntry } from "../../../types/stream";
import { Block } from "../Block";
import styles from "./renderers.module.css";

interface TaskBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

function resolveTitle(entry: ToolCallEntry): { title: string; badge: string; icon: React.ReactNode } {
  const Icon = entry.name === "transition_task"
    ? <ArrowRightCircle size={12} />
    : entry.name === "update_task"
      ? <CheckSquare size={12} />
      : <ClipboardList size={12} />;

  const inputTitle = (entry.input.title as string) || "";
  const status = (entry.input.status as string) || "";
  const badge = entry.name === "update_task"
    ? "Update"
    : entry.name === "transition_task"
      ? (status || "Task")
      : "Task";

  if (inputTitle) return { title: inputTitle, badge, icon: Icon };
  const taskId = (entry.input.task_id as string) || "";
  if (taskId) return { title: taskId.slice(0, 12), badge, icon: Icon };
  return { title: "Task", badge, icon: Icon };
}

export function TaskBlock({ entry, defaultExpanded }: TaskBlockProps) {
  const { title, badge, icon } = resolveTitle(entry);
  const description = (entry.input.description as string) || "";
  const firstLine = description.split("\n")[0]?.slice(0, 240) || "";
  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  return (
    <Block
      icon={icon}
      title={title}
      badge={badge}
      status={status}
      defaultExpanded={defaultExpanded ?? false}
      flushBody
    >
      <div className={styles.taskTitle}>{title}</div>
      {firstLine ? <div className={styles.taskDesc}>{firstLine}</div> : null}
      {entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : null}
    </Block>
  );
}
