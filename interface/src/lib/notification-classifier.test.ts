import { describe, expect, it } from "vitest";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import { NotificationKind } from "../shared/types/notifications";
import { classifyNotification } from "./notification-classifier";

function baseEvent(type: AuraEvent["type"], content: AuraEvent["content"]): AuraEvent {
  return {
    event_id: "evt-1",
    session_id: "session-1",
    user_id: "user-1",
    agent_id: "agent-1",
    sender: "agent",
    project_id: "project-1",
    org_id: "org-1",
    type,
    content,
    created_at: "2026-07-08T12:00:00.000Z",
  } as AuraEvent;
}

describe("classifyNotification", () => {
  it("classifies task completion as a low-priority notification", () => {
    const notification = classifyNotification(
      baseEvent(EventType.TaskCompleted, {
        task_id: "task-1",
        task_title: "Ship notifications",
      }),
    );

    expect(notification).toMatchObject({
      id: "task_completed:task-1",
      kind: NotificationKind.TaskCompleted,
      priority: 0,
      title: "Task complete",
      body: "Ship notifications",
      route: "/projects/project-1/tasks",
    });
  });

  it("classifies task failure as high priority with a reason", () => {
    const notification = classifyNotification(
      baseEvent(EventType.TaskFailed, {
        task_id: "task-2",
        task_title: "Run tests",
        reason: "cargo test failed",
      }),
    );

    expect(notification).toMatchObject({
      id: "task_failed:task-2",
      kind: NotificationKind.TaskFailed,
      priority: 1,
      body: "Run tests: cargo test failed",
    });
  });

  it("classifies failed loop endings as high priority", () => {
    const notification = classifyNotification(
      baseEvent(EventType.LoopEnded, {
        loop_id: {
          user_id: "user-1",
          project_id: "project-1",
          agent_id: "agent-1",
          kind: "task_run",
          instance: "loop-1",
        },
        activity: {
          status: "failed",
          started_at: "2026-07-08T11:59:00.000Z",
          last_event_at: "2026-07-08T12:00:00.000Z",
          current_step: "Waiting for retry budget",
        },
      }),
    );

    expect(notification).toMatchObject({
      id: "loop_ended:task_run:loop-1:failed",
      kind: NotificationKind.LoopEnded,
      priority: 1,
      title: "Task run failed",
      body: "Waiting for retry budget",
    });
  });

  it("returns null for non-notification events", () => {
    expect(
      classifyNotification(
        baseEvent(EventType.TaskStarted, {
          task_id: "task-3",
        }),
      ),
    ).toBeNull();
  });
});
