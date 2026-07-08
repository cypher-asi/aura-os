export const NotificationKind = {
  TaskCompleted: "task_completed",
  TaskFailed: "task_failed",
  TaskRetrying: "task_retrying",
  LoopEnded: "loop_ended",
  ProjectPushStuck: "project_push_stuck",
} as const;

export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

export type NotificationPriority = 0 | 1;

export type NotificationCondition = "unfocused" | "always";

export interface AuraNotification {
  id: string;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  body: string;
  createdAt: number;
  taskId?: string;
  projectId?: string;
  route?: string;
}

export type NotificationTypePreferences = Record<NotificationKind, boolean>;

export interface NotificationPreferences {
  enabled: boolean;
  desktopEnabled: boolean;
  inAppEnabled: boolean;
  browserEnabled: boolean;
  soundEnabled: boolean;
  condition: NotificationCondition;
  types: NotificationTypePreferences;
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  [NotificationKind.TaskCompleted]: "Task completions",
  [NotificationKind.TaskFailed]: "Task failures",
  [NotificationKind.TaskRetrying]: "Task retries",
  [NotificationKind.LoopEnded]: "Loop endings",
  [NotificationKind.ProjectPushStuck]: "Push needs attention",
};

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    enabled: true,
    desktopEnabled: true,
    inAppEnabled: true,
    browserEnabled: false,
    soundEnabled: true,
    condition: "unfocused",
    types: {
      [NotificationKind.TaskCompleted]: true,
      [NotificationKind.TaskFailed]: true,
      [NotificationKind.TaskRetrying]: false,
      [NotificationKind.LoopEnded]: true,
      [NotificationKind.ProjectPushStuck]: true,
    },
  };
}
