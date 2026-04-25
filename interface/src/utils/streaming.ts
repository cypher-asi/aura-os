import type { ToolCallEntry } from "../shared/types/stream";
import { TOOL_PHASE_LABELS } from "../constants/tools";

const CONNECTING_LABELS = [
  "Syncing",
  "Wiring",
  "Connecting",
  "Routing",
  "Relating",
  "Integrating",
] as const;

let _cachedConnectingLabel: string | null = null;

function pickConnectingLabel(): string {
  if (!_cachedConnectingLabel) {
    _cachedConnectingLabel =
      CONNECTING_LABELS[Math.floor(Math.random() * CONNECTING_LABELS.length)];
  }
  return _cachedConnectingLabel;
}

export function getStreamingPhaseLabel(state: {
  thinkingText?: string;
  streamingText: string;
  toolCalls: ToolCallEntry[];
  progressText?: string;
  isWriting?: boolean;
}): string | null {
  // While text is actively revealing word-by-word the prose itself is
  // the indicator — hide the cooking row so it does not flicker under
  // the cursor.
  if (state.isWriting) return null;

  const pending = state.toolCalls.find((tc) => tc.pending);
  if (pending) return TOOL_PHASE_LABELS[pending.name] ?? "Working...";
  if (state.thinkingText && !state.streamingText) return "Thinking...";
  if (state.toolCalls.length > 0) return "Putting it all together...";
  if (state.progressText) {
    if (state.progressText.toLowerCase() === "connecting") {
      return pickConnectingLabel();
    }
    return state.progressText;
  }
  _cachedConnectingLabel = null;
  return "Cooking...";
}
