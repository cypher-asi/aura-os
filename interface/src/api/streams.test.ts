import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiClientError } from "../shared/api/core";
import {
  attachToStream,
  generateSpecsStream,
  selectReattachableChatStream,
  sendAgentEventStream,
  sendEventStream,
} from "./streams";
import type {
  SpecGenStreamCallbacks,
  StreamEventHandler,
} from "./streams";
import type { ActiveStreamSummary } from "../shared/api/streams";
import * as sseModule from "../shared/api/sse";
import { handleEngineEvent } from "../stores/event-store/engine-event-handlers";

vi.mock("../shared/api/sse", () => ({
  streamSSE: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../stores/event-store/engine-event-handlers", () => ({
  handleEngineEvent: vi.fn(),
}));

const streamSSE = sseModule.streamSSE as ReturnType<typeof vi.fn>;
const mockedHandleEngineEvent = vi.mocked(handleEngineEvent);

describe("generateSpecsStream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls streamSSE with correct URL and method", async () => {
    const cb: SpecGenStreamCallbacks = {
      onProgress: vi.fn(),
      onDelta: vi.fn(),
      onGenerating: vi.fn(),
      onSpecSaved: vi.fn(),
      onTaskSaved: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    await generateSpecsStream("p1" as string, cb);

    expect(streamSSE).toHaveBeenCalledOnce();
    const [url, init] = streamSSE.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/p1/specs/generate/stream");
    expect(init.method).toBe("POST");
  });

  it("passes abort signal through", async () => {
    const controller = new AbortController();
    const cb: SpecGenStreamCallbacks = {
      onProgress: vi.fn(),
      onDelta: vi.fn(),
      onGenerating: vi.fn(),
      onSpecSaved: vi.fn(),
      onTaskSaved: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    await generateSpecsStream("p1" as string, cb, undefined, controller.signal);
    expect(streamSSE.mock.calls[0][3]).toBe(controller.signal);
  });

  it("appends agent_instance_id when provided", async () => {
    const cb: SpecGenStreamCallbacks = {
      onProgress: vi.fn(),
      onDelta: vi.fn(),
      onGenerating: vi.fn(),
      onSpecSaved: vi.fn(),
      onTaskSaved: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    await generateSpecsStream("p1" as string, cb, "ai 1");

    const [url] = streamSSE.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/p1/specs/generate/stream?agent_instance_id=ai%201");
  });

  it("routes SSE events to correct callbacks", async () => {
    const cb: SpecGenStreamCallbacks = {
      onProgress: vi.fn(),
      onDelta: vi.fn(),
      onGenerating: vi.fn(),
      onSpecSaved: vi.fn(),
      onTaskSaved: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    await generateSpecsStream("p1" as string, cb);

    const sseCallbacks = streamSSE.mock.calls[0][2] as {
      onEvent: (type: string, data: unknown) => void;
      onError: (err: Error) => void;
    };

    sseCallbacks.onEvent("progress", { stage: "analyzing" });
    expect(cb.onProgress).toHaveBeenCalledWith("analyzing");

    sseCallbacks.onEvent("delta", { text: "chunk" });
    expect(cb.onDelta).toHaveBeenCalledWith("chunk");

    sseCallbacks.onEvent("generating", { tokens: 42 });
    expect(cb.onGenerating).toHaveBeenCalledWith(42);

    sseCallbacks.onEvent("error", { message: "fail" });
    expect(cb.onError).toHaveBeenCalledWith("fail");

    sseCallbacks.onEvent("complete", { specs: [] });
    expect(cb.onComplete).toHaveBeenCalledWith([]);
  });

  it("routes onError from SSE transport to cb.onError", async () => {
    const cb: SpecGenStreamCallbacks = {
      onProgress: vi.fn(),
      onDelta: vi.fn(),
      onGenerating: vi.fn(),
      onSpecSaved: vi.fn(),
      onTaskSaved: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    await generateSpecsStream("p1" as string, cb);

    const sseCallbacks = streamSSE.mock.calls[0][2] as {
      onError: (err: Error) => void;
    };
    sseCallbacks.onError(new Error("transport fail"));
    expect(cb.onError).toHaveBeenCalledWith("transport fail");
  });
});

describe("sendAgentEventStream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls streamSSE with agent message URL", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendAgentEventStream("a1", "hello", "chat", undefined, undefined, handler);

    const [url, init] = streamSSE.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agents/a1/events/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ content: "hello", action: "chat" });
  });

  it("correlates a persisted standalone command receipt", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
      onAccepted: vi.fn(),
    };

    await sendAgentEventStream(
      "a1",
      "hello",
      null,
      undefined,
      undefined,
      handler,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "command-1",
    );

    const [, init, , , options] = streamSSE.mock.calls[0] as [
      string,
      RequestInit,
      unknown,
      unknown,
      { onResponse: (response: Response) => void },
    ];
    expect(JSON.parse(init.body as string).client_command_id).toBe("command-1");
    options.onResponse(new Response(null, {
      headers: {
        "x-aura-chat-persisted": "true",
        "x-aura-chat-command-id": "command-1",
        "x-aura-chat-session-id": "session-1",
        "x-aura-chat-project-id": "project-1",
      },
    }));

    expect(handler.onAccepted).toHaveBeenCalledWith({
      commandId: "command-1",
      sessionId: "session-1",
      projectId: "project-1",
      attachId: null,
      replayed: false,
    });
  });

  it("marks a replay and exposes its original live-stream receipt", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
      onAccepted: vi.fn(),
    };

    await sendAgentEventStream(
      "a1", "hello", null, undefined, undefined, handler,
      undefined, undefined, undefined, false, "session-1", undefined,
      undefined, undefined, "command-1", true, true,
    );

    const [, init, , , options] = streamSSE.mock.calls[0] as [
      string,
      RequestInit,
      unknown,
      unknown,
      { onResponse: (response: Response) => void },
    ];
    expect((init.headers as Record<string, string>)["X-Aura-Command-Replay"]).toBe("1");
    expect((init.headers as Record<string, string>)["X-Aura-Command-Previously-Accepted"]).toBe("1");
    options.onResponse(new Response(null, {
      headers: {
        "x-aura-chat-persisted": "true",
        "x-aura-chat-command-id": "command-1",
        "x-aura-chat-session-id": "session-1",
        "x-aura-chat-project-id": "project-1",
        "x-aura-attach-id": "attach-1",
        "x-aura-chat-command-replayed": "true",
        "x-aura-chat-execution-status": "unconfirmed",
      },
    }));
    expect(handler.onAccepted).toHaveBeenCalledWith({
      commandId: "command-1",
      sessionId: "session-1",
      projectId: "project-1",
      attachId: "attach-1",
      replayed: true,
      executionStatus: "unconfirmed",
    });
  });

  it("rejects a mismatched command receipt", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendAgentEventStream(
      "a1",
      "hello",
      null,
      undefined,
      undefined,
      handler,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "command-1",
    );

    const options = streamSSE.mock.calls[0][4] as {
      onResponse: (response: Response) => void;
    };
    expect(() => options.onResponse(new Response(null, {
      headers: {
        "x-aura-chat-persisted": "true",
        "x-aura-chat-command-id": "another-command",
      },
    }))).toThrow("Aura could not confirm that this message was saved");
  });

  it("includes attachments in body when provided", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    const attachments = [{ type: "image" as const, media_type: "image/png", data: "base64data" }];

    await sendAgentEventStream("a1", "look", null, undefined, attachments, handler);

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.attachments).toEqual(attachments);
  });

  it("omits attachments from body when empty", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendAgentEventStream("a1", "hi", "ask", undefined, [], handler);

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.attachments).toBeUndefined();
  });

  it("keeps standalone agent chat request body bounded and explicit", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    const attachments = [{ type: "text" as const, media_type: "text/plain", data: "content", name: "notes.txt" }];

    await sendAgentEventStream(
      "a1",
      "ship this",
      "chat",
      "aura-gpt-5-4",
      attachments,
      handler,
      undefined,
      ["run_tests"],
      "p1",
      true,
    );

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      content: "ship this",
      action: "chat",
      model: "aura-gpt-5-4",
      attachments,
      commands: ["run_tests"],
      project_id: "p1",
      new_session: true,
      reasoning_effort: "minimal",
    });
    expect(body.history).toBeUndefined();
    expect(body.messages).toBeUndefined();
    expect(body.system_prompt).toBeUndefined();
    expect(body.context).toBeUndefined();
  });

  it("routes chat stream events via parseAuraEvent to handler", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    };

    await sendAgentEventStream("a1", "hi", null, undefined, undefined, handler);

    const sseCallbacks = streamSSE.mock.calls[0][2] as {
      onEvent: (type: string, data: unknown) => void;
      onDone: () => void;
    };

    sseCallbacks.onEvent("delta", { text: "word" });
    expect(handler.onEvent).toHaveBeenCalledTimes(1);
    const event = (handler.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.type).toBe("delta");
    expect(event.content.text).toBe("word");

    sseCallbacks.onDone();
    expect(handler.onDone).toHaveBeenCalled();
  });

  it("keeps live tool approval prompts in the typed chat event pipeline", async () => {
    const handler: StreamEventHandler = { onEvent: vi.fn(), onError: vi.fn() };
    await sendAgentEventStream("a1", "hi", null, undefined, undefined, handler);
    const callbacks = streamSSE.mock.calls[0][2] as {
      onEvent: (type: string, data: unknown) => void;
    };

    callbacks.onEvent("tool_approval_prompt", {
      request_id: "approval-1",
      tool_name: "write_file",
      args: { path: "src/main.ts" },
      agent_id: "a1",
      remember_options: ["once", "session"],
    });

    expect(handler.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "tool_approval_prompt",
      content: expect.objectContaining({ request_id: "approval-1", tool_name: "write_file" }),
    }));
  });

  it("falls back to the tagged payload event type when the SSE event name is generic", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendAgentEventStream("a1", "hi", null, undefined, undefined, handler);

    const sseCallbacks = streamSSE.mock.calls[0][2] as {
      onEvent: (type: string, data: unknown) => void;
    };

    sseCallbacks.onEvent("message", { type: "text_delta", text: "word" });

    expect(handler.onEvent).toHaveBeenCalledTimes(1);
    const event = (handler.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.type).toBe("text_delta");
    expect(event.content.text).toBe("word");
  });

  it("forwards task_saved events into the shared engine store", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendAgentEventStream("a1", "hi", null, undefined, undefined, handler);

    const sseCallbacks = streamSSE.mock.calls[0][2] as {
      onEvent: (type: string, data: unknown) => void;
    };

    sseCallbacks.onEvent("message", {
      type: "task_saved",
      project_id: "p1",
      task: { task_id: "task-1", title: "Realtime task" },
      task_id: "task-1",
    });

    expect(mockedHandleEngineEvent).toHaveBeenCalledTimes(1);
    expect(mockedHandleEngineEvent.mock.calls[0]?.[0]).toMatchObject({
      type: "task_saved",
      project_id: "p1",
      content: expect.objectContaining({
        task_id: "task-1",
      }),
    });
  });

  it("preserves transport errors for chat handlers", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendAgentEventStream("a1", "hi", null, undefined, undefined, handler);

    const sseCallbacks = streamSSE.mock.calls[0][2] as {
      onError: (err: Error) => void;
    };
    const err = new ApiClientError(402, {
      error: "billing server error",
      code: "insufficient_credits",
      details: null,
    });

    sseCallbacks.onError(err);

    expect(handler.onError).toHaveBeenCalledWith(err);
  });
});

describe("sendEventStream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls streamSSE with project agent instance URL", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendEventStream("p1" as string, "ai1", "msg", "plan", undefined, undefined, handler);

    const [url, init] = streamSSE.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/p1/agents/ai1/events/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ content: "msg", action: "plan" });
  });

  it("includes attachments when provided", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    const attachments = [{ type: "text" as const, media_type: "text/plain", data: "content", name: "file.txt" }];

    await sendEventStream("p1" as string, "ai1", "check", null, undefined, attachments, handler);

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.attachments).toEqual(attachments);
  });

  it("keeps project chat request body bounded and explicit", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    const attachments = [{ type: "text" as const, media_type: "text/plain", data: "content", name: "notes.txt" }];

    await sendEventStream(
      "p1" as string,
      "ai1",
      "continue",
      "chat",
      "claude-sonnet-4-5-20250929",
      attachments,
      handler,
      undefined,
      ["inspect_repo"],
      true,
    );

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      content: "continue",
      action: "chat",
      model: "claude-sonnet-4-5-20250929",
      attachments,
      commands: ["inspect_repo"],
      new_session: true,
    });
    expect(body.history).toBeUndefined();
    expect(body.messages).toBeUndefined();
    expect(body.system_prompt).toBeUndefined();
    expect(body.context).toBeUndefined();
  });

  it("passes signal through", async () => {
    const controller = new AbortController();
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendEventStream("p1" as string, "ai1", "x", null, undefined, undefined, handler, controller.signal);
    expect(streamSSE.mock.calls[0][3]).toBe(controller.signal);
  });

  it("includes mixture payload when provided", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendEventStream(
      "p1" as string,
      "ai1",
      "review this",
      "chat",
      "final-model",
      undefined,
      handler,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        references: [{ id: "reference-model", reasoning_effort: "high" }],
        aggregator: { id: "final-model", reasoning_effort: "medium" },
      },
    );

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.mixture).toEqual({
      references: [{ id: "reference-model", reasoning_effort: "high" }],
      aggregator: { id: "final-model", reasoning_effort: "medium" },
    });
  });

  it("includes exact project-agent mention bindings", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendEventStream(
      "p1" as string,
      "ai1",
      "ask @Maya to review",
      "chat",
      undefined,
      undefined,
      handler,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [{ agent_id: "agent-maya", agent_instance_id: "instance-maya" }],
    );

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.agent_mentions).toEqual([
      { agent_id: "agent-maya", agent_instance_id: "instance-maya" },
    ]);
  });

  it("opts a project turn into the safe workspace when requested", async () => {
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendEventStream(
      "p1" as string,
      "ai1",
      "edit safely",
      "chat",
      undefined,
      undefined,
      handler,
      undefined,
      undefined,
      false,
      "session-1",
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    const body = JSON.parse((streamSSE.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.safe_workspace).toBe(true);
    expect(body.session_id).toBe("session-1");
  });
});

function makeStream(over: Partial<ActiveStreamSummary> = {}): ActiveStreamSummary {
  return {
    attach_id: "att-1",
    kind: "chat_turn",
    scope: { user_id: "u1", project_id: "p1", agent_instance_id: "ai1", session_id: "s1" },
    latest_seq: 3,
    terminated: false,
    started_at_ms: 0,
    ...over,
  };
}

describe("selectReattachableChatStream", () => {
  it("returns null when no session id is pinned", () => {
    expect(selectReattachableChatStream([makeStream()], null)).toBeNull();
    expect(selectReattachableChatStream([makeStream()], undefined)).toBeNull();
  });

  it("matches a live chat_turn stream by session id", () => {
    const match = makeStream({ scope: { session_id: "s1" } });
    expect(selectReattachableChatStream([match], "s1")).toBe(match);
  });

  it("ignores terminated streams", () => {
    const terminated = makeStream({ terminated: true, scope: { session_id: "s1" } });
    expect(selectReattachableChatStream([terminated], "s1")).toBeNull();
  });

  it("ignores streams for a different session", () => {
    const other = makeStream({ scope: { session_id: "s2" } });
    expect(selectReattachableChatStream([other], "s1")).toBeNull();
  });

  it("ignores non-chat_turn kinds (e.g. media generation)", () => {
    const media = makeStream({ kind: "image_gen", scope: { session_id: "s1" } });
    expect(selectReattachableChatStream([media], "s1")).toBeNull();
  });

  it("picks the matching session out of a mixed list", () => {
    const a = makeStream({ attach_id: "a", scope: { session_id: "s-other" } });
    const b = makeStream({ attach_id: "b", scope: { session_id: "s1" } });
    expect(selectReattachableChatStream([a, b], "s1")).toBe(b);
  });
});

describe("attachToStream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("targets the attach endpoint and resumes from `since`", async () => {
    const handler: StreamEventHandler = { onEvent: vi.fn(), onError: vi.fn() };
    await attachToStream("att 1", 12, handler);
    const [url, init, , , options] = streamSSE.mock.calls[0] as [
      string,
      RequestInit,
      unknown,
      unknown,
      { resumable?: boolean },
    ];
    expect(url).toBe("/api/streams/att%201?since=12");
    expect(init.method).toBe("GET");
    expect(options.resumable).toBe(true);
  });

  it("omits the since param when reattaching from 0", async () => {
    const handler: StreamEventHandler = { onEvent: vi.fn(), onError: vi.fn() };
    await attachToStream("att-1", 0, handler);
    const [url] = streamSSE.mock.calls[0] as [string];
    expect(url).toBe("/api/streams/att-1");
  });

  it("forwards normal chat frames to the handler", async () => {
    const handler: StreamEventHandler = { onEvent: vi.fn(), onError: vi.fn() };
    await attachToStream("att-1", 0, handler);
    const callbacks = streamSSE.mock.calls[0][2] as {
      onEvent: (type: string, data: unknown) => void;
    };
    callbacks.onEvent("delta", { text: "hi" });
    expect(handler.onEvent).toHaveBeenCalledTimes(1);
    expect((handler.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0].type).toBe("delta");
  });

  it("intercepts stream_resync_required and does not forward it as a chat event", async () => {
    const handler: StreamEventHandler = { onEvent: vi.fn(), onError: vi.fn() };
    const onResync = vi.fn();
    await attachToStream("att-1", 0, handler, undefined, { onResync });
    const callbacks = streamSSE.mock.calls[0][2] as {
      onEvent: (type: string, data: unknown) => void;
    };
    callbacks.onEvent("stream_resync_required", { type: "stream_resync_required", last_seq: 42 });
    expect(onResync).toHaveBeenCalledWith(42);
    expect(handler.onEvent).not.toHaveBeenCalled();
  });

  it("threads onSeq through to streamSSE options", async () => {
    const handler: StreamEventHandler = { onEvent: vi.fn(), onError: vi.fn() };
    const onSeq = vi.fn();
    await attachToStream("att-1", 0, handler, undefined, { onSeq });
    const options = streamSSE.mock.calls[0][4] as { onSeq?: (n: number) => void };
    expect(options.onSeq).toBe(onSeq);
  });
});
