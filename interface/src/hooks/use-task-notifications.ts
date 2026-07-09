import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import type { AuraNotification } from "../shared/types/notifications";
import { classifyNotification } from "../lib/notification-classifier";
import { useEventStore } from "../stores/event-store/event-store";
import { useNotificationPreferencesStore } from "../stores/notification-preferences-store";
import { peekIsTaskStreaming } from "../stores/task-stream-bootstrap";
import { useToastStore } from "../stores/toast-store";

const DESKTOP_FOCUS_EVENT = "aura-desktop-focus-changed";
const STALE_EVENT_GRACE_MS = 5_000;
const TASK_COMPLETION_DEDUPE_WINDOW_MS = 2_500;
const RECENT_TERMINAL_LOOP_WINDOW_MS = TASK_COMPLETION_DEDUPE_WINDOW_MS;

interface NativeNotificationPayload {
  id: string;
  title: string;
  body: string;
  sound: boolean;
  badgeCount?: number;
}

export function useTaskNotifications(enabled = true): void {
  const preferences = useNotificationPreferencesStore((state) => state.preferences);
  const addToast = useToastStore((state) => state.addToast);
  const preferencesRef = useRef(preferences);
  const addToastRef = useRef(addToast);
  const focusedRef = useRef(isAppFocused());
  const mountedAtRef = useRef<number | null>(null);
  const seenRef = useRef(new Set<string>());
  const pendingTaskCompletionsRef = useRef(new Map<string, PendingTaskCompletion>());
  const recentTerminalLoopScopesRef = useRef(new Map<string, number>());
  const badgeCountRef = useRef(0);

  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  useEffect(() => {
    const updateFocus = (focused: boolean) => {
      focusedRef.current = focused;
      if (focused) {
        badgeCountRef.current = 0;
      }
    };
    const handleNativeFocus = (event: Event) => {
      const focused = (event as CustomEvent<{ focused?: unknown }>).detail?.focused;
      if (typeof focused === "boolean") {
        updateFocus(focused);
      }
    };
    const handleFocus = () => updateFocus(isAppFocused());

    window.addEventListener(DESKTOP_FOCUS_EVENT, handleNativeFocus);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener(DESKTOP_FOCUS_EVENT, handleNativeFocus);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const subscribe = useEventStore.getState().subscribe;
    const pendingTaskCompletions = pendingTaskCompletionsRef.current;
    const recentTerminalLoopScopes = recentTerminalLoopScopesRef.current;
    const handler = (event: AuraEvent) => {
      handleNotificationEvent({
        event,
        mountedAt: mountedAtRef.current ?? 0,
        getFocused: () => focusedRef.current,
        seen: seenRef.current,
        pendingTaskCompletions,
        recentTerminalLoopScopes,
        badgeCountRef,
        addToast: addToastRef.current,
      });
    };

    const unsubscribe = combineUnsubscribes(
      subscribe(EventType.TaskCompleted, handler),
      subscribe(EventType.TaskFailed, handler),
      subscribe(EventType.TaskRetrying, handler),
      subscribe(EventType.LoopEnded, handler),
      subscribe(EventType.ProjectPushStuck, handler),
    );
    return () => {
      unsubscribe();
      clearPendingTaskCompletions(pendingTaskCompletions);
    };
  }, [enabled]);
}

interface PendingTaskCompletion {
  scopeKey: string | null;
  queuedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface HandleNotificationEventInput {
  event: AuraEvent;
  mountedAt: number;
  getFocused: () => boolean;
  seen: Set<string>;
  pendingTaskCompletions: Map<string, PendingTaskCompletion>;
  recentTerminalLoopScopes: Map<string, number>;
  badgeCountRef: MutableRefObject<number>;
  addToast: (notification: AuraNotification) => void;
}

function handleNotificationEvent({
  event,
  mountedAt,
  getFocused,
  seen,
  pendingTaskCompletions,
  recentTerminalLoopScopes,
  badgeCountRef,
  addToast,
}: HandleNotificationEventInput): void {
  if (!isFreshEvent(event, mountedAt)) return;
  const notification = classifyNotification(event);
  if (!notification || seen.has(notification.id)) return;

  if (!isNotificationTypeEnabled(notification)) return;

  if (event.type === EventType.TaskCompleted) {
    if (hasRecentTerminalLoop(event, recentTerminalLoopScopes)) return;
    scheduleTaskCompletionNotification({
      notification,
      event,
      getFocused,
      seen,
      pendingTaskCompletions,
      badgeCountRef,
      addToast,
    });
    return;
  }

  if (event.type === EventType.LoopEnded) {
    if (loopCanSupersedeTaskCompletion(event)) {
      cancelPendingTaskCompletionForLoop(event, pendingTaskCompletions);
    }
  } else if (event.type === EventType.TaskFailed) {
    cancelPendingTaskCompletionForTask(event.content.task_id, pendingTaskCompletions);
  }

  deliverNotification({
    notification,
    focused: getFocused(),
    seen,
    badgeCountRef,
    addToast,
  });

  if (event.type === EventType.LoopEnded) {
    if (loopCanSupersedeTaskCompletion(event)) {
      rememberTerminalLoop(event, recentTerminalLoopScopes);
    }
  }
}

function deliverNotification({
  notification,
  focused,
  seen,
  badgeCountRef,
  addToast,
}: {
  notification: AuraNotification;
  focused: boolean;
  seen: Set<string>;
  badgeCountRef: MutableRefObject<number>;
  addToast: (notification: AuraNotification) => void;
}): void {
  if (seen.has(notification.id) || !isNotificationTypeEnabled(notification)) return;
  const preferences = useNotificationPreferencesStore.getState().preferences;
  seen.add(notification.id);

  if (preferences.inAppEnabled) {
    addToast(notification);
  }

  if (!preferences.desktopEnabled || !hasDesktopBridge()) return;
  if (!shouldSendDesktopNotification(notification, focused, preferences.condition)) {
    return;
  }
  if (
    notification.priority === 0 &&
    notification.taskId &&
    focused &&
    peekIsTaskStreaming(notification.taskId)
  ) {
    return;
  }

  badgeCountRef.current += 1;
  postNativeNotification(notification, {
    sound: preferences.soundEnabled,
    badgeCount: badgeCountRef.current,
  });
}

function scheduleTaskCompletionNotification({
  notification,
  event,
  getFocused,
  seen,
  pendingTaskCompletions,
  badgeCountRef,
  addToast,
}: {
  notification: AuraNotification;
  event: AuraEvent;
  getFocused: () => boolean;
  seen: Set<string>;
  pendingTaskCompletions: Map<string, PendingTaskCompletion>;
  badgeCountRef: MutableRefObject<number>;
  addToast: (notification: AuraNotification) => void;
}): void {
  if (pendingTaskCompletions.has(notification.id)) return;
  const timer = setTimeout(() => {
    pendingTaskCompletions.delete(notification.id);
    deliverNotification({
      notification,
      focused: getFocused(),
      seen,
      badgeCountRef,
      addToast,
    });
  }, TASK_COMPLETION_DEDUPE_WINDOW_MS);

  pendingTaskCompletions.set(notification.id, {
    scopeKey: notificationScopeKey(event),
    queuedAt: Date.now(),
    timer,
  });
}

function cancelPendingTaskCompletionForLoop(
  event: Extract<AuraEvent, { type: typeof EventType.LoopEnded }>,
  pendingTaskCompletions: Map<string, PendingTaskCompletion>,
): void {
  const loopScopeKey = notificationScopeKey(event);
  if (!loopScopeKey) return;
  let newestPendingId: string | null = null;
  let newestQueuedAt = -1;

  for (const [id, pending] of pendingTaskCompletions) {
    if (pending.scopeKey !== loopScopeKey) continue;
    if (pending.queuedAt > newestQueuedAt) {
      newestPendingId = id;
      newestQueuedAt = pending.queuedAt;
    }
  }

  if (!newestPendingId) return;
  const pending = pendingTaskCompletions.get(newestPendingId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingTaskCompletions.delete(newestPendingId);
}

function cancelPendingTaskCompletionForTask(
  taskId: string | undefined,
  pendingTaskCompletions: Map<string, PendingTaskCompletion>,
): void {
  if (!taskId) return;
  const pendingId = `task_completed:${taskId}`;
  const pending = pendingTaskCompletions.get(pendingId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingTaskCompletions.delete(pendingId);
}

function clearPendingTaskCompletions(
  pendingTaskCompletions: Map<string, PendingTaskCompletion>,
): void {
  pendingTaskCompletions.forEach((pending) => clearTimeout(pending.timer));
  pendingTaskCompletions.clear();
}

function isNotificationTypeEnabled(notification: AuraNotification): boolean {
  const preferences = useNotificationPreferencesStore.getState().preferences;
  return preferences.enabled && preferences.types[notification.kind];
}

function rememberTerminalLoop(
  event: Extract<AuraEvent, { type: typeof EventType.LoopEnded }>,
  recentTerminalLoopScopes: Map<string, number>,
): void {
  const scopeKey = notificationScopeKey(event);
  if (!scopeKey) return;
  const now = Date.now();
  pruneRecentTerminalLoops(recentTerminalLoopScopes, now);
  recentTerminalLoopScopes.set(scopeKey, now);
}

function hasRecentTerminalLoop(
  event: AuraEvent,
  recentTerminalLoopScopes: Map<string, number>,
): boolean {
  const scopeKey = notificationScopeKey(event);
  if (!scopeKey) return false;
  const now = Date.now();
  pruneRecentTerminalLoops(recentTerminalLoopScopes, now);
  const lastTerminalAt = recentTerminalLoopScopes.get(scopeKey);
  return (
    typeof lastTerminalAt === "number" &&
    now - lastTerminalAt <= RECENT_TERMINAL_LOOP_WINDOW_MS
  );
}

function pruneRecentTerminalLoops(
  recentTerminalLoopScopes: Map<string, number>,
  now: number,
): void {
  for (const [scopeKey, deliveredAt] of recentTerminalLoopScopes) {
    if (now - deliveredAt > RECENT_TERMINAL_LOOP_WINDOW_MS) {
      recentTerminalLoopScopes.delete(scopeKey);
    }
  }
}

function notificationScopeKey(event: AuraEvent): string | null {
  const projectId =
    event.type === EventType.LoopEnded
      ? (event.content.loop_id.project_id ?? event.project_id)
      : event.project_id;
  const agentKey =
    event.type === EventType.LoopEnded
      ? (event.content.loop_id.agent_instance_id ??
        event.project_agent_id ??
        event.content.loop_id.agent_id ??
        event.agent_id)
      : (event.project_agent_id ?? event.agent_id);

  return projectId && agentKey ? `${projectId}:${agentKey}` : null;
}

function loopCanSupersedeTaskCompletion(
  event: Extract<AuraEvent, { type: typeof EventType.LoopEnded }>,
): boolean {
  const { activity, loop_id } = event.content;
  return (
    (loop_id.kind === "task_run" || loop_id.kind === "automation") &&
    (activity.status === "completed" ||
      activity.status === "failed" ||
      activity.status === "cancelled")
  );
}

function shouldSendDesktopNotification(
  notification: AuraNotification,
  focused: boolean,
  condition: "unfocused" | "always",
): boolean {
  if (notification.priority === 1) return true;
  if (condition === "always") return true;
  return !focused;
}

function postNativeNotification(
  notification: AuraNotification,
  options: { sound: boolean; badgeCount: number },
): void {
  const payload: NativeNotificationPayload = {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    sound: options.sound,
    badgeCount: options.badgeCount,
  };
  window.ipc?.postMessage(
    JSON.stringify({
      type: "native_notification",
      payload,
    }),
  );
}

function hasDesktopBridge(): boolean {
  return typeof window.ipc?.postMessage === "function";
}

function isAppFocused(): boolean {
  return document.visibilityState !== "hidden" && document.hasFocus();
}

function isFreshEvent(event: AuraEvent, mountedAt: number): boolean {
  const eventTime = Date.parse(event.created_at);
  if (!Number.isFinite(eventTime)) return true;
  return eventTime >= mountedAt - STALE_EVENT_GRACE_MS;
}

function combineUnsubscribes(...unsubscribes: Array<() => void>): () => void {
  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}
