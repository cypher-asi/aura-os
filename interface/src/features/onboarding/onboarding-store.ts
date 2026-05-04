import { create } from "zustand";
import { ONBOARDING_STORAGE_PREFIX, ONBOARDING_TASKS } from "./onboarding-constants";

const TOTAL_TASKS = ONBOARDING_TASKS.length;

function defaultTasks(): Record<string, boolean> {
  const tasks: Record<string, boolean> = {};
  for (const t of ONBOARDING_TASKS) tasks[t.id] = false;
  return tasks;
}

interface PersistedState {
  welcomeCompleted: boolean;
  welcomeSkipped: boolean;
  checklistDismissed: boolean;
  checklistTasks: Record<string, boolean>;
}

function storageKey(userId: string): string {
  return `${ONBOARDING_STORAGE_PREFIX}:${userId}`;
}

function readState(userId: string): PersistedState {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { welcomeCompleted: false, welcomeSkipped: false, checklistDismissed: false, checklistTasks: defaultTasks() };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        welcomeCompleted: !!parsed.welcomeCompleted,
        welcomeSkipped: !!parsed.welcomeSkipped,
        checklistDismissed: !!parsed.checklistDismissed,
        checklistTasks: { ...defaultTasks(), ...(parsed.checklistTasks ?? {}) },
      };
    }
  } catch {
    // ignore malformed data
  }
  return { welcomeCompleted: false, welcomeSkipped: false, checklistDismissed: false, checklistTasks: defaultTasks() };
}

function writeState(userId: string, state: PersistedState): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

function countCompleted(tasks: Record<string, boolean>): number {
  return Object.values(tasks).filter(Boolean).length;
}

interface OnboardingState {
  // Identity
  userId: string | null;

  // Welcome
  welcomeCompleted: boolean;
  welcomeSkipped: boolean;
  welcomeStep: number;

  // Checklist
  checklistDismissed: boolean;
  checklistTasks: Record<string, boolean>;
  checklistCollapsed: boolean;

  // Actions
  hydrateForUser: (userId: string) => void;
  completeWelcome: () => void;
  skipWelcome: () => void;
  setWelcomeStep: (step: number) => void;
  completeTask: (taskId: string) => void;
  dismissChecklist: () => void;
  reopenChecklist: () => void;
  toggleChecklistCollapsed: () => void;
  resetOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>()((set, get) => {
  function persist(): void {
    const s = get();
    if (!s.userId) return;
    writeState(s.userId, {
      welcomeCompleted: s.welcomeCompleted,
      welcomeSkipped: s.welcomeSkipped,
      checklistDismissed: s.checklistDismissed,
      checklistTasks: s.checklistTasks,
    });
  }

  return {
    userId: null,
    welcomeCompleted: false,
    welcomeSkipped: false,
    welcomeStep: 0,
    checklistDismissed: false,
    checklistTasks: defaultTasks(),
    checklistCollapsed: false,

    hydrateForUser: (userId) => {
      const saved = readState(userId);
      set({ userId, ...saved, welcomeStep: 0, checklistCollapsed: false });
    },

    completeWelcome: () => {
      set({ welcomeCompleted: true });
      persist();
    },

    skipWelcome: () => {
      set({ welcomeSkipped: true });
      persist();
    },

    setWelcomeStep: (step) => {
      set({ welcomeStep: step });
    },

    completeTask: (taskId) => {
      const s = get();
      if (s.checklistTasks[taskId]) return; // already done
      const next = { ...s.checklistTasks, [taskId]: true };
      set({ checklistTasks: next });
      persist();
    },

    dismissChecklist: () => {
      set({ checklistDismissed: true });
      persist();
    },

    reopenChecklist: () => {
      set({ checklistDismissed: false, checklistCollapsed: false });
      persist();
    },

    toggleChecklistCollapsed: () => {
      set((s) => ({ checklistCollapsed: !s.checklistCollapsed }));
    },

    resetOnboarding: () => {
      set({
        welcomeCompleted: false,
        welcomeSkipped: false,
        welcomeStep: 0,
        checklistDismissed: false,
        checklistTasks: defaultTasks(),
        checklistCollapsed: false,
      });
      persist();
    },
  };
});

// ── Selectors ──

export function selectIsWelcomeVisible(s: OnboardingState): boolean {
  return s.userId !== null && !s.welcomeCompleted && !s.welcomeSkipped;
}

export function selectIsChecklistVisible(s: OnboardingState): boolean {
  if (s.userId === null) return false;
  if (!s.welcomeCompleted && !s.welcomeSkipped) return false; // welcome still showing
  if (s.checklistDismissed) return false;
  if (countCompleted(s.checklistTasks) >= TOTAL_TASKS) return false; // all done
  return true;
}

export function selectCompletedCount(s: OnboardingState): number {
  return countCompleted(s.checklistTasks);
}

export function selectTotalTasks(): number {
  return TOTAL_TASKS;
}

export function selectProgressPercent(s: OnboardingState): number {
  return Math.round((countCompleted(s.checklistTasks) / TOTAL_TASKS) * 100);
}

export function selectIsFullyComplete(s: OnboardingState): boolean {
  return countCompleted(s.checklistTasks) >= TOTAL_TASKS;
}
