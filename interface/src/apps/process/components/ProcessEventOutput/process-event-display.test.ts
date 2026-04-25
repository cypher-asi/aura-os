import type { ProcessEvent } from "../../../../shared/types";
import { buildProcessEventDisplay } from "./process-event-display";

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

describe("buildProcessEventDisplay", () => {
  it("preserves tool snapshot input for persisted file actions", () => {
    const { message } = buildProcessEventDisplay(
      makeEvent({
        content_blocks: [
          { type: "tool_use", id: "tool-1", name: "write_file" },
          {
            type: "tool_call_snapshot",
            id: "tool-1",
            name: "write_file",
            input: {
              path: "notes.txt",
              content: "hello",
            },
          },
          { type: "tool_result", tool_use_id: "tool-1", name: "write_file", result: "ok", is_error: false },
        ],
      }),
    );

    expect(message?.toolCalls).toHaveLength(1);
    expect(message?.toolCalls?.[0]).toMatchObject({
      id: "tool-1",
      name: "write_file",
      input: {
        path: "notes.txt",
        content: "hello",
      },
      pending: false,
      result: "ok",
    });
  });

  it("matches persisted tool results to tool calls by name when ids are missing", () => {
    const { message } = buildProcessEventDisplay(
      makeEvent({
        content_blocks: [
          { type: "tool_use", id: "tool-1", name: "search_docs" },
          { type: "tool_result", name: "search_docs", result: "Found docs", is_error: false },
        ],
      }),
    );

    expect(message?.toolCalls).toHaveLength(1);
    expect(message?.toolCalls?.[0]).toMatchObject({
      id: "tool-1",
      name: "search_docs",
      pending: false,
      result: "Found docs",
      isError: false,
    });
  });

  it("forces unresolved tool calls into a terminal state for failed events", () => {
    const { message } = buildProcessEventDisplay(
      makeEvent({
        status: "failed",
        content_blocks: [
          { type: "tool_use", id: "tool-1", name: "write_file" },
        ],
      }),
    );

    expect(message?.toolCalls).toHaveLength(1);
    expect(message?.toolCalls?.[0]).toMatchObject({
      id: "tool-1",
      name: "write_file",
      pending: false,
      isError: true,
      result: "Run failed before a tool result was persisted",
    });
  });
});
