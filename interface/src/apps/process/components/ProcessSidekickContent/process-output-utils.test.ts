import type {
  ProcessEvent,
} from "../../../../shared/types";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import {
  buildProcessSidekickCopyText,
} from "./process-output-utils";

function makeEvent(overrides: Partial<ProcessEvent> = {}): ProcessEvent {
  return {
    event_id: "evt-1",
    run_id: "run-1",
    node_id: "node-1",
    process_id: "proc-1",
    status: "completed",
    input_snapshot: "",
    output: "",
    started_at: "2026-04-06T20:00:00.000Z",
    completed_at: "2026-04-06T20:00:05.000Z",
    ...overrides,
  };
}

describe("buildProcessSidekickCopyText", () => {
  const nodes = [{ node_id: "node-1", label: "Draft reply" }];

  it("includes distinct structured output when content blocks are also present", () => {
    const text = buildProcessSidekickCopyText({
      events: [
        makeEvent({
          content_blocks: [{ type: "text", text: "Draft answer" }],
          output: '{"saved_path":"tmp/output.md"}',
          input_snapshot: '{"prompt":"hello"}',
        }),
      ],
      nodes,
      isActive: false,
    });

    expect(text).toContain("Draft answer");
    expect(text).toContain('"saved_path": "tmp/output.md"');
    expect(text).toContain('{"prompt":"hello"}');
  });

  it("includes current live stream content while the run is active", () => {
    const priorMessage: DisplaySessionEvent = {
      id: "msg-1",
      role: "assistant",
      content: "",
      timeline: [{ kind: "text", id: "text-1", content: "Prior streamed chunk" }],
    };

    const text = buildProcessSidekickCopyText({
      events: [],
      nodes,
      isActive: true,
      liveNodeLabel: "Draft reply",
      liveState: {
        events: [priorMessage],
        streamingText: "Current live chunk",
        thinkingText: "",
        activeToolCalls: [],
        timeline: [],
      },
    });

    expect(text).toContain("# Live Output: Draft reply");
    expect(text).toContain("Prior streamed chunk");
    expect(text).toContain("Current live chunk");
  });
});
