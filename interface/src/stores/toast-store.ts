import { create } from "zustand";
import type { AuraNotification } from "../shared/types/notifications";

export type ToastNotification = AuraNotification & {
  expiresAt: number;
};

interface ToastState {
  toasts: ToastNotification[];
  addToast: (notification: AuraNotification) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

const MAX_TOASTS = 3;
const TOAST_DURATION_MS = 6_000;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  addToast: (notification) => {
    const toast: ToastNotification = {
      ...notification,
      expiresAt: Date.now() + TOAST_DURATION_MS,
    };
    set((state) => ({
      toasts: [
        toast,
        ...state.toasts.filter((existing) => existing.id !== notification.id),
      ].slice(0, MAX_TOASTS),
    }));
  },
  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
  clearToasts: () => set({ toasts: [] }),
}));
