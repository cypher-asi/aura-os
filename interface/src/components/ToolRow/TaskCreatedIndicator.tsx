import type { ToolCallEntry } from "../../types/stream";
import toolStyles from "./ToolCallBlock.module.css";

export function TaskCreatedIndicator({ entry }: { entry: ToolCallEntry }) {
  const title = (entry.input.title as string) || "";
  const description = (entry.input.description as string) || "";
  const firstLine = description.split("\n")[0]?.slice(0, 140) || "";

  return (
    <div className={toolStyles.taskIndicator}>
      {title && (
        <div className={toolStyles.taskIndicatorRow}>
          <span className={toolStyles.taskIndicatorTitle}>{title}</span>
        </div>
      )}
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
