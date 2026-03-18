import type { ToolCallEntry } from "../hooks/use-chat-stream";
import styles from "./CookingIndicator.module.css";

const TOOL_PHASE_LABELS: Record<string, string> = {
  read_file: "Reading files...",
  write_file: "Writing code...",
  list_files: "Browsing the project...",
  delete_file: "Cleaning up...",
  create_spec: "Drafting specs...",
  update_spec: "Drafting specs...",
  list_specs: "Reviewing specs...",
  get_spec: "Reviewing specs...",
  delete_spec: "Reviewing specs...",
  create_task: "Organizing tasks...",
  update_task: "Organizing tasks...",
  list_tasks: "Managing tasks...",
  delete_task: "Managing tasks...",
  transition_task: "Managing tasks...",
  run_task: "Running a task...",
  start_dev_loop: "Firing up the dev loop...",
  pause_dev_loop: "Managing the dev loop...",
  stop_dev_loop: "Managing the dev loop...",
  get_project: "Checking the project...",
  update_project: "Checking the project...",
  get_progress: "Crunching numbers...",
};

export function getStreamingPhaseLabel(state: {
  thinkingText?: string;
  streamingText: string;
  toolCalls: ToolCallEntry[];
}): string | null {
  if (state.streamingText) return null;
  const pending = state.toolCalls.find((tc) => tc.pending);
  if (pending) return TOOL_PHASE_LABELS[pending.name] ?? "Working...";
  if (state.thinkingText) return "Thinking...";
  if (state.toolCalls.length > 0) return "Putting it all together...";
  return "Cooking...";
}

interface CookingIndicatorProps {
  label?: string;
}

export function CookingIndicator({ label = "Cooking..." }: CookingIndicatorProps) {
  return (
    <div className={styles.cookingIndicator}>
      <span className={styles.cookingText}>{label}</span>
    </div>
  );
}
