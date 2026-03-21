import { Plus } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import toolStyles from "../ToolCallBlock.module.css";

export function TaskCreatedIndicator({ entry }: { entry: ToolCallEntry }) {
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
        <div className={toolStyles.inlineErrorCompact}>
          {entry.result.slice(0, 200)}
        </div>
      )}
    </div>
  );
}
