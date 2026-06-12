import type { StreamRefs, StreamSetters } from "../../shared/types/stream";

export function makeRefs(): StreamRefs {
  return {
    streamBuffer: { current: "" },
    thinkingBuffer: { current: "" },
    thinkingStart: { current: null },
    toolCalls: { current: [] },
    raf: { current: null },
    flushTimeout: { current: null },
    displayedTextLength: { current: 0 },
    lastTextFlushAt: { current: 0 },
    thinkingRaf: { current: null },
    timeline: { current: [] },
    snapshottedToolCallIds: { current: new Set() },
  };
}

export function makeSetters(): StreamSetters & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  function track(name: string) {
    return (v: unknown) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(v);
    };
  }
  // The batched display-tick setter records both the raw patch AND
  // mirrors each present field into the matching per-field record, so
  // assertions like `calls.setStreamingText` keep observing the values
  // a component would have received regardless of which path published
  // them.
  const recordPatch = track("applyStreamingPatch");
  const recordStreamingText = track("setStreamingText");
  const recordThinkingText = track("setThinkingText");
  const recordTimeline = track("setTimeline");
  const recordIsWriting = track("setIsWriting");
  const applyStreamingPatch: StreamSetters["applyStreamingPatch"] = (patch) => {
    recordPatch(patch);
    if (patch.streamingText !== undefined) recordStreamingText(patch.streamingText);
    if (patch.thinkingText !== undefined) recordThinkingText(patch.thinkingText);
    if (patch.timeline !== undefined) recordTimeline(patch.timeline);
    if (patch.isWriting !== undefined) recordIsWriting(patch.isWriting);
  };
  return {
    applyStreamingPatch,
    setStreamingText: recordStreamingText as StreamSetters["setStreamingText"],
    setThinkingText: recordThinkingText as StreamSetters["setThinkingText"],
    setThinkingDurationMs: track("setThinkingDurationMs") as StreamSetters["setThinkingDurationMs"],
    setActiveToolCalls: track("setActiveToolCalls") as StreamSetters["setActiveToolCalls"],
    setEvents: track("setEvents") as StreamSetters["setEvents"],
    setIsStreaming: track("setIsStreaming") as StreamSetters["setIsStreaming"],
    setIsWriting: recordIsWriting as StreamSetters["setIsWriting"],
    setProgressText: track("setProgressText") as StreamSetters["setProgressText"],
    setTimeline: recordTimeline as StreamSetters["setTimeline"],
    setGenerationState: track("setGenerationState") as StreamSetters["setGenerationState"],
    setGenerationPercent: track("setGenerationPercent") as StreamSetters["setGenerationPercent"],
    clearGeneration: track("clearGeneration") as StreamSetters["clearGeneration"],
    calls,
  };
}
