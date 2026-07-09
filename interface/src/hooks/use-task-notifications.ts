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
    const handler = (event: AuraEvent) => {
      handleNotificationEvent({
        event,
        mountedAt: mountedAtRef.current ?? 0,
        focused: focusedRef.current,
        seen: seenRef.current,
        badgeCountRef,
        addToast: addToastRef.current,
      });
    };

    return combineUnsubscribes(
      subscribe(EventType.TaskCompleted, handler),
      subscribe(EventType.TaskFailed, handler),
      subscribe(EventType.TaskRetrying, handler),
      subscribe(EventType.LoopEnded, handler),
      subscribe(EventType.ProjectPushStuck, handler),
    );
  }, [enabled]);
}

interface HandleNotificationEventInput {
  event: AuraEvent;
  mountedAt: number;
  focused: boolean;
  seen: Set<string>;
  badgeCountRef: MutableRefObject<number>;
  addToast: (notification: AuraNotification) => void;
}

function handleNotificationEvent({
  event,
  mountedAt,
  focused,
  seen,
  badgeCountRef,
  addToast,
}: HandleNotificationEventInput): void {
  if (!isFreshEvent(event, mountedAt)) return;
  const notification = classifyNotification(event);
  if (!notification || seen.has(notification.id)) return;

  const preferences = useNotificationPreferencesStore.getState().preferences;
  if (!preferences.enabled || !preferences.types[notification.kind]) return;

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
