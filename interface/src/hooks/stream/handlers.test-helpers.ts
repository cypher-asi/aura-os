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
  return {
    setStreamingText: track("setStreamingText") as StreamSetters["setStreamingText"],
    setThinkingText: track("setThinkingText") as StreamSetters["setThinkingText"],
    setThinkingDurationMs: track("setThinkingDurationMs") as StreamSetters["setThinkingDurationMs"],
    setActiveToolCalls: track("setActiveToolCalls") as StreamSetters["setActiveToolCalls"],
    setEvents: track("setEvents") as StreamSetters["setEvents"],
    setIsStreaming: track("setIsStreaming") as StreamSetters["setIsStreaming"],
    setIsWriting: track("setIsWriting") as StreamSetters["setIsWriting"],
    setProgressText: track("setProgressText") as StreamSetters["setProgressText"],
    setTimeline: track("setTimeline") as StreamSetters["setTimeline"],
    calls,
  };
}
