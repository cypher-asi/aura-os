import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import {
  type AuraNotification,
  NotificationKind,
  type NotificationPriority,
} from "../shared/types/notifications";

export function classifyNotification(event: AuraEvent): AuraNotification | null {
  switch (event.type) {
    case EventType.TaskCompleted:
      return taskNotification({
        event,
        kind: NotificationKind.TaskCompleted,
        priority: 0,
        title: "Task complete",
        fallbackBody: "A task finished successfully.",
      });
    case EventType.TaskFailed:
      return taskNotification({
        event,
        kind: NotificationKind.TaskFailed,
        priority: 1,
        title: "Task failed",
        fallbackBody: "A task failed and needs attention.",
        detail: event.content.reason,
      });
    case EventType.TaskRetrying:
      return taskNotification({
        event,
        kind: NotificationKind.TaskRetrying,
        priority: 0,
        title: "Task retrying",
        fallbackBody: "Aura is retrying a task.",
        detail: event.content.reason,
      });
    case EventType.LoopEnded:
      return classifyLoopEnded(event);
    case EventType.ProjectPushStuck:
      return {
        id: `project_push_stuck:${event.project_id}:${event.created_at}`,
        kind: NotificationKind.ProjectPushStuck,
        priority: 1,
        title: "Push needs attention",
        body:
          event.content.remediation?.trim() ||
          event.content.reason?.trim() ||
          "A project has repeated push failures.",
        createdAt: Date.parse(event.created_at) || Date.now(),
        projectId: event.project_id,
        taskId: event.content.task_id,
        route: projectRoute(event.project_id),
      };
    default:
      return null;
  }
}

function classifyLoopEnded(
  event: Extract<AuraEvent, { type: typeof EventType.LoopEnded }>,
): AuraNotification | null {
  const { activity, loop_id } = event.content;
  const status = activity.status;
  if (status !== "completed" && status !== "failed" && status !== "cancelled") {
    return null;
  }
  const priority: NotificationPriority = status === "completed" ? 0 : 1;
  const projectId = loop_id.project_id ?? event.project_id;
  const taskId = activity.current_task_id ?? undefined;
  const label = loopKindLabel(loop_id.kind);
  const title =
    status === "completed"
      ? `${label} complete`
      : status === "cancelled"
        ? `${label} cancelled`
        : `${label} failed`;
  return {
    id: `loop_ended:${loop_id.kind}:${loop_id.instance}:${status}`,
    kind: NotificationKind.LoopEnded,
    priority,
    title,
    body: activity.current_step?.trim() || `${label} ended with status ${status}.`,
    createdAt: Date.parse(event.created_at) || Date.now(),
    taskId,
    projectId,
    route: projectRoute(projectId),
  };
}

function taskNotification(args: {
  event: Extract<
    AuraEvent,
    {
      type:
        | typeof EventType.TaskCompleted
        | typeof EventType.TaskFailed
        | typeof EventType.TaskRetrying;
    }
  >;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  fallbackBody: string;
  detail?: string;
}): AuraNotification | null {
  const { event, kind, priority, title, fallbackBody, detail } = args;
  const taskId = event.content.task_id;
  if (!taskId) return null;
  const rawTitle =
    "task_title" in event.content ? event.content.task_title : undefined;
  const taskTitle = rawTitle?.trim();
  const body = [taskTitle || fallbackBody, detail?.trim()]
    .filter(Boolean)
    .join(": ");
  const attemptSuffix =
    event.type === EventType.TaskRetrying ? `:${event.content.attempt}` : "";
  return {
    id: `${kind}:${taskId}${attemptSuffix}`,
    kind,
    priority,
    title,
    body,
    createdAt: Date.parse(event.created_at) || Date.now(),
    taskId,
    projectId: event.project_id,
    route: projectRoute(event.project_id),
  };
}

function projectRoute(projectId: string | null | undefined): string | undefined {
  return projectId ? `/projects/${projectId}/tasks` : undefined;
}

function loopKindLabel(kind: string): string {
  if (kind === "task_run") return "Task run";
  if (kind === "spec_gen") return "Spec generation";
  if (kind === "process_run") return "Process run";
  return "Loop";
}
