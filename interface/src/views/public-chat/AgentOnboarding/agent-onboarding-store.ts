import { create } from "zustand";

/**
 * Ordered list of onboarding stages. The wizard's stepper and Back/Next
 * navigation are driven entirely by this array, so reordering or renaming a
 * stage is a single-line edit here.
 */
export const ONBOARDING_STEPS = [
  "identity",
  "expertise",
  "integrations",
  "connections",
  "automations",
  "launch",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

/**
 * The selections a visitor makes while walking the wizard. Applied to the
 * user's CEO super-agent after account creation (see
 * `apply-agent-onboarding.ts`). Deliberately has no agent-name field: the
 * configured agent is the canonical CEO whose name/role are fixed to "ceo".
 */
export interface AgentOnboardingDraft {
  /** Value applied to `agent.icon` — a persona image URL or an upload data URI. */
  readonly avatar: string | null;
  /** Free-text personality applied to `agent.personality`. */
  readonly personality: string;
  /** Marketplace expertise slugs. */
  readonly expertise: readonly string[];
  /** Harness skill names to install. */
  readonly skills: readonly string[];
  /** Integration ids the visitor intends to connect (deferred, post-signup). */
  readonly integrations: readonly string[];
  /** Messaging provider ids the visitor intends to connect (deferred). */
  readonly messaging: readonly string[];
  /** Automation preset ids the visitor is interested in (deferred). */
  readonly automations: readonly string[];
}

export function emptyDraft(): AgentOnboardingDraft {
  return {
    avatar: null,
    personality: "",
    expertise: [],
    skills: [],
    integrations: [],
    messaging: [],
    automations: [],
  };
}

const STORAGE_KEY = "aura:agent-onboarding:draft";

interface PersistedState {
  readonly draft: AgentOnboardingDraft;
  readonly pendingApply: boolean;
}

function readPersisted(): PersistedState {
  if (typeof localStorage === "undefined") {
    return { draft: emptyDraft(), pendingApply: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { draft: emptyDraft(), pendingApply: false };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { draft: emptyDraft(), pendingApply: false };
    }
    const obj = parsed as { draft?: Partial<AgentOnboardingDraft>; pendingApply?: unknown };
    return {
      draft: { ...emptyDraft(), ...(obj.draft ?? {}) },
      pendingApply: obj.pendingApply === true,
    };
  } catch {
    return { draft: emptyDraft(), pendingApply: false };
  }
}

function toStringArray(value: readonly string[] | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}

function toggle(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

interface AgentOnboardingState {
  isOpen: boolean;
  /** Marketing surface that opened the wizard (analytics breadcrumb). */
  source: string | null;
  currentStep: number;
  draft: AgentOnboardingDraft;
  /**
   * Set when the visitor reaches account creation so that, once authenticated,
   * `useApplyAgentOnboarding` knows to configure the CEO with the draft.
   */
  pendingApply: boolean;
  /** True while the Launch step's account-creation request is in flight, so the
   *  footer "Create account" button can show progress and guard double-submits. */
  launchSubmitting: boolean;

  open: (source?: string) => void;
  close: () => void;
  next: () => void;
  back: () => void;
  goTo: (step: number) => void;

  setAvatar: (avatar: string) => void;
  setPersonality: (personality: string) => void;
  toggleExpertise: (slug: string) => void;
  toggleSkill: (name: string) => void;
  toggleIntegration: (id: string) => void;
  toggleMessaging: (id: string) => void;
  toggleAutomation: (id: string) => void;

  setLaunchSubmitting: (value: boolean) => void;
  /** Mark the draft ready to apply after authentication resolves. */
  markPendingApply: () => void;
  /** Read the draft and clear the pending flag + persisted state. */
  consumePendingDraft: () => AgentOnboardingDraft | null;
  resetDraft: () => void;
}

export const useAgentOnboardingStore = create<AgentOnboardingState>()((set, get) => {
  const initial = readPersisted();

  function persist(): void {
    if (typeof localStorage === "undefined") return;
    const { draft, pendingApply } = get();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ draft, pendingApply }));
    } catch {
      // ignore storage failures (private mode / quota)
    }
  }

  function clampStep(step: number): number {
    if (step < 0) return 0;
    if (step > ONBOARDING_STEP_COUNT - 1) return ONBOARDING_STEP_COUNT - 1;
    return step;
  }

  return {
    isOpen: false,
    source: null,
    currentStep: 0,
    draft: initial.draft,
    pendingApply: initial.pendingApply,
    launchSubmitting: false,

    open: (source) => set({ isOpen: true, source: source ?? null, currentStep: 0, launchSubmitting: false }),
    close: () => set({ isOpen: false, launchSubmitting: false }),
    next: () => set((s) => ({ currentStep: clampStep(s.currentStep + 1) })),
    back: () => set((s) => ({ currentStep: clampStep(s.currentStep - 1) })),
    goTo: (step) => set({ currentStep: clampStep(step) }),

    setAvatar: (avatar) => {
      set((s) => ({ draft: { ...s.draft, avatar } }));
      persist();
    },
    setPersonality: (personality) => {
      set((s) => ({ draft: { ...s.draft, personality } }));
      persist();
    },
    toggleExpertise: (slug) => {
      set((s) => ({ draft: { ...s.draft, expertise: toggle(toStringArray(s.draft.expertise), slug) } }));
      persist();
    },
    toggleSkill: (name) => {
      set((s) => ({ draft: { ...s.draft, skills: toggle(toStringArray(s.draft.skills), name) } }));
      persist();
    },
    toggleIntegration: (id) => {
      set((s) => ({ draft: { ...s.draft, integrations: toggle(toStringArray(s.draft.integrations), id) } }));
      persist();
    },
    toggleMessaging: (id) => {
      set((s) => ({ draft: { ...s.draft, messaging: toggle(toStringArray(s.draft.messaging), id) } }));
      persist();
    },
    toggleAutomation: (id) => {
      set((s) => ({ draft: { ...s.draft, automations: toggle(toStringArray(s.draft.automations), id) } }));
      persist();
    },

    setLaunchSubmitting: (value) => set({ launchSubmitting: value }),
    markPendingApply: () => {
      set({ pendingApply: true });
      persist();
    },
    consumePendingDraft: () => {
      const { pendingApply, draft } = get();
      if (!pendingApply) return null;
      set({ pendingApply: false });
      persist();
      return draft;
    },
    resetDraft: () => {
      set({ draft: emptyDraft(), pendingApply: false, currentStep: 0 });
      persist();
    },
  };
});
