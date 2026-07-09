import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import { useNotificationPreferencesStore } from "../stores/notification-preferences-store";
import { subscribers } from "../stores/event-store/event-store";
import { useToastStore } from "../stores/toast-store";
import { useTaskNotifications } from "./use-task-notifications";

vi.mock("../stores/task-stream-bootstrap", () => ({
  peekIsTaskStreaming: vi.fn(() => false),
}));

const NOW = new Date("2026-07-09T12:00:00.000Z");
const TASK_COMPLETION_DEDUPE_WINDOW_MS = 2_500;

function baseEvent(
  type: AuraEvent["type"],
  content: AuraEvent["content"],
  overrides: Partial<AuraEvent> = {},
): AuraEvent {
  return {
    event_id: `${type}-event`,
    session_id: "session-1",
    user_id: "user-1",
    agent_id: "agent-1",
    project_agent_id: "project-agent-1",
    sender: "agent",
    project_id: "project-1",
    org_id: "org-1",
    type,
    content,
    created_at: new Date(Date.now()).toISOString(),
    ...overrides,
  } as AuraEvent;
}

function emit(event: AuraEvent): void {
  act(() => {
    subscribers.get(event.type)?.forEach((callback) => callback(event));
  });
}

function postedNotificationIds(postMessage: ReturnType<typeof vi.fn>): string[] {
  return postMessage.mock.calls.map(([raw]) => {
    const message = JSON.parse(String(raw)) as { payload: { id: string } };
    return message.payload.id;
  });
}

describe("useTaskNotifications", () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    subscribers.clear();
    useToastStore.getState().clearToasts();
    useNotificationPreferencesStore.getState().reset();
    useNotificationPreferencesStore.getState().setCondition("always");
    postMessage = vi.fn();
    window.ipc = { postMessage };
  });

  afterEach(() => {
    cleanup();
    delete window.ipc;
    subscribers.clear();
    useToastStore.getState().clearToasts();
    vi.useRealTimers();
  });

  it("delays task completion briefly, then delivers when no terminal loop arrives", () => {
    renderHook(() => useTaskNotifications());

    emit(
      baseEvent(EventType.TaskCompleted, {
        task_id: "task-1",
        task_title: "Ship notifications",
      }),
    );

    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(TASK_COMPLETION_DEDUPE_WINDOW_MS);
    });

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual([
      "task_completed:task-1",
    ]);
    expect(postedNotificationIds(postMessage)).toEqual(["task_completed:task-1"]);
  });

  it("suppresses duplicate task completion when the terminal task-run loop arrives", () => {
    renderHook(() => useTaskNotifications());

    emit(
      baseEvent(EventType.TaskCompleted, {
        task_id: "task-1",
        task_title: "Ship notifications",
      }),
    );

    emit(
      baseEvent(EventType.LoopEnded, {
        loop_id: {
          user_id: "user-1",
          project_id: "project-1",
          agent_instance_id: "project-agent-1",
          agent_id: "agent-1",
          kind: "task_run",
          instance: "loop-1",
        },
        activity: {
          status: "completed",
          started_at: "2026-07-09T11:59:00.000Z",
          last_event_at: "2026-07-09T12:00:00.000Z",
          current_task_id: null,
          current_step: "Ship notifications",
        },
      }),
    );

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual([
      "loop_ended:task_run:loop-1:completed",
    ]);
    expect(postedNotificationIds(postMessage)).toEqual([
      "loop_ended:task_run:loop-1:completed",
    ]);

    act(() => {
      vi.advanceTimersByTime(TASK_COMPLETION_DEDUPE_WINDOW_MS);
    });

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual([
      "loop_ended:task_run:loop-1:completed",
    ]);
    expect(postedNotificationIds(postMessage)).toEqual([
      "loop_ended:task_run:loop-1:completed",
    ]);
  });

  it("suppresses late task completion after a terminal task-run loop", () => {
    renderHook(() => useTaskNotifications());

    emit(
      baseEvent(EventType.LoopEnded, {
        loop_id: {
          user_id: "user-1",
          project_id: "project-1",
          agent_instance_id: "project-agent-1",
          agent_id: "agent-1",
          kind: "task_run",
          instance: "loop-1",
        },
        activity: {
          status: "completed",
          started_at: "2026-07-09T11:59:00.000Z",
          last_event_at: "2026-07-09T12:00:00.000Z",
          current_task_id: null,
          current_step: "Ship notifications",
        },
      }),
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });

    emit(
      baseEvent(EventType.TaskCompleted, {
        task_id: "task-1",
        task_title: "Ship notifications",
      }),
    );

    act(() => {
      vi.advanceTimersByTime(TASK_COMPLETION_DEDUPE_WINDOW_MS);
    });

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual([
      "loop_ended:task_run:loop-1:completed",
    ]);
    expect(postedNotificationIds(postMessage)).toEqual([
      "loop_ended:task_run:loop-1:completed",
    ]);
  });

  it("cancels a pending task completion when the same task fails", () => {
    renderHook(() => useTaskNotifications());

    emit(
      baseEvent(EventType.TaskCompleted, {
        task_id: "task-1",
        task_title: "Ship notifications",
      }),
    );

    emit(
      baseEvent(EventType.TaskFailed, {
        task_id: "task-1",
        task_title: "Ship notifications",
        reason: "verification failed",
      }),
    );

    act(() => {
      vi.advanceTimersByTime(TASK_COMPLETION_DEDUPE_WINDOW_MS);
    });

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual([
      "task_failed:task-1",
    ]);
    expect(postedNotificationIds(postMessage)).toEqual(["task_failed:task-1"]);
  });
});
