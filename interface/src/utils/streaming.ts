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
  /**
   * Accepted for backwards-compat with callers that still forward the
   * stream entry's `isWriting` flag, but intentionally unused: the
   * pinned cooking shimmer must stay visible for the entire active
   * turn rather than oscillate on every word-reveal step. Visibility
   * is gated upstream by `nowStreaming` in the indicator components.
   */
  isWriting?: boolean;
}): string | null {
  if (state.progressText === "model_retrying") return "Connection interrupted — retrying…";
  const realToolCalls = state.toolCalls.filter((tc) => !tc.synthetic);
  const pending = realToolCalls.find((tc) => tc.pending);
  if (pending) return TOOL_PHASE_LABELS[pending.name] ?? "Working...";
  // Once any tool has run, prefer the "assembling" phase over a bare
  // "Thinking..." — `thinkingText` lingers from the turn's earlier
  // reasoning and is not cleared when tools complete, so keying off it
  // here showed a stale "Thinking..." while the model was clearly past
  // that phase (tools already finished, nothing pending). The live
  // thinking block in the timeline still shimmers for any genuinely
  // open reasoning segment, so reasoning is never hidden.
  if (realToolCalls.length > 0) return "Putting it all together...";
  if (state.thinkingText && !state.streamingText) return "Thinking...";
  if (state.progressText) {
    if (state.progressText.toLowerCase() === "connecting") {
      return pickConnectingLabel();
    }
    if (state.progressText.toLowerCase() === "queued") {
      return "Queued...";
    }
    return state.progressText;
  }
  _cachedConnectingLabel = null;
  return "Cooking...";
}
