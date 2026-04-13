import { useEffect } from 'react';
import { X, Check, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import styles from './Toasts.module.css';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  duration?: number;
}

export interface ToastsProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const iconMap = {
  success: Check,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export function Toasts({ toasts, onRemove }: ToastsProps) {
  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => onRemove(toast.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const Icon = iconMap[toast.type];
  const duration = toast.duration ?? 4000;

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
    return;
  }, [duration, onClose]);

  return (
    <div className={clsx(styles.toast, styles[toast.type])}>
      <Icon className={styles.icon} />
      <div className={styles.content}>
        <p className={styles.title}>{toast.title}</p>
        {toast.message && <p className={styles.message}>{toast.message}</p>}
      </div>
      <button onClick={onClose} className={styles.closeButton}>
        <X size={14} />
      </button>
    </div>
  );
}
