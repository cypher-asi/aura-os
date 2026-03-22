import type { ToolCallEntry } from "../types/stream";
import { TOOL_PHASE_LABELS } from "../constants/tools";

export function getStreamingPhaseLabel(state: {
  thinkingText?: string;
  streamingText: string;
  toolCalls: ToolCallEntry[];
  progressText?: string;
}): string | null {
  if (state.progressText) return state.progressText;
  const pending = state.toolCalls.find((tc) => tc.pending);
  if (pending) return TOOL_PHASE_LABELS[pending.name] ?? "Working...";
  if (state.thinkingText && !state.streamingText) return "Thinking...";
  if (state.streamingText) return "Writing...";
  if (state.toolCalls.length > 0) return "Putting it all together...";
  return "Cooking...";
}
