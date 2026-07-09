import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, RotateCw, X, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NotificationKind } from "../../shared/types/notifications";
import type { ToastNotification } from "../../stores/toast-store";
import { useToastStore } from "../../stores/toast-store";
import styles from "./Toast.module.css";

const ICONS: Record<NotificationKind, LucideIcon> = {
  [NotificationKind.TaskCompleted]: CheckCircle2,
  [NotificationKind.TaskFailed]: XCircle,
  [NotificationKind.TaskRetrying]: RotateCw,
  [NotificationKind.LoopEnded]: AlertTriangle,
  [NotificationKind.ProjectPushStuck]: AlertTriangle,
};

export function ToastViewport(): React.ReactElement | null {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(
        () => dismissToast(toast.id),
        Math.max(0, toast.expiresAt - Date.now()),
      ),
    );
    return () => {
      timers.forEach(window.clearTimeout);
    };
  }, [dismissToast, toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.viewport} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: ToastNotification;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps): React.ReactElement {
  const navigate = useNavigate();
  const Icon = ICONS[toast.kind];
  const clickable = Boolean(toast.route);

  return (
    <div
      className={styles.toast}
      data-priority={toast.priority}
      data-clickable={clickable || undefined}
      onClick={() => {
        if (!toast.route) return;
        navigate(toast.route);
        onDismiss(toast.id);
      }}
      onKeyDown={(event) => {
        if (!toast.route || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        navigate(toast.route);
        onDismiss(toast.id);
      }}
      role={clickable ? "button" : "presentation"}
      tabIndex={clickable ? 0 : undefined}
    >
      <Icon className={styles.icon} aria-hidden="true" size={18} />
      <div className={styles.copy}>
        <div className={styles.title}>{toast.title}</div>
        <div className={styles.body}>{toast.body}</div>
      </div>
      <button
        type="button"
        className={styles.dismissButton}
        aria-label="Dismiss notification"
        title="Dismiss notification"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(toast.id);
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
