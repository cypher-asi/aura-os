import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEventContext, EventProvider } from "./EventContext";

vi.mock("../hooks/use-event-stream", () => ({
  useEventStream: () => ({
    connected: false,
    events: [],
    latestEvent: null,
  }),
}));

describe("useEventContext", () => {
  it("throws when used outside EventProvider", () => {
    expect(() => renderHook(() => useEventContext())).toThrow(
      "useEventContext must be used within an EventProvider",
    );
  });

  it("returns context value when inside EventProvider", () => {
    const { result } = renderHook(() => useEventContext(), {
      wrapper: ({ children }) => <EventProvider>{children}</EventProvider>,
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.events).toEqual([]);
    expect(result.current.latestEvent).toBeNull();
    expect(typeof result.current.subscribe).toBe("function");
    expect(typeof result.current.getTaskOutput).toBe("function");
    expect(typeof result.current.subscribeTaskOutput).toBe("function");
    expect(typeof result.current.seedTaskOutput).toBe("function");
  });

  it("getTaskOutput returns empty output for unknown task", () => {
    const { result } = renderHook(() => useEventContext(), {
      wrapper: ({ children }) => <EventProvider>{children}</EventProvider>,
    });
    const output = result.current.getTaskOutput("nonexistent");
    expect(output.text).toBe("");
    expect(output.fileOps).toEqual([]);
    expect(output.buildSteps).toEqual([]);
    expect(output.testSteps).toEqual([]);
  });

  it("seedTaskOutput populates task output", () => {
    const { result } = renderHook(() => useEventContext(), {
      wrapper: ({ children }) => <EventProvider>{children}</EventProvider>,
    });

    result.current.seedTaskOutput("task-1", "Build output...");
    const output = result.current.getTaskOutput("task-1");
    expect(output.text).toBe("Build output...");
  });

  it("seedTaskOutput does not overwrite existing output", () => {
    const { result } = renderHook(() => useEventContext(), {
      wrapper: ({ children }) => <EventProvider>{children}</EventProvider>,
    });

    result.current.seedTaskOutput("task-2", "First");
    result.current.seedTaskOutput("task-2", "Second");
    const output = result.current.getTaskOutput("task-2");
    expect(output.text).toBe("First");
  });

  it("subscribe returns an unsubscribe function", () => {
    const { result } = renderHook(() => useEventContext(), {
      wrapper: ({ children }) => <EventProvider>{children}</EventProvider>,
    });
    const unsub = result.current.subscribe("task_started", vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
