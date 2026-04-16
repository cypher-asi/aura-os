import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiClientError } from "./core";
import {
  generateSpecsStream,
  sendAgentEventStream,
  sendEventStream,
} from "./streams";
import type {
  SpecGenStreamCallbacks,
  StreamEventHandler,
} from "./streams";
import * as sseModule from "./sse";
import { handleEngineEvent } from "../stores/event-store/engine-event-handlers";

vi.mock("./sse", () => ({
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

  it("passes signal through", async () => {
    const controller = new AbortController();
    const handler: StreamEventHandler = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await sendEventStream("p1" as string, "ai1", "x", null, undefined, undefined, handler, controller.signal);
    expect(streamSSE.mock.calls[0][3]).toBe(controller.signal);
  });
});
