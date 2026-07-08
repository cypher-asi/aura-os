import { create } from "zustand";
import {
  defaultNotificationPreferences,
  type NotificationCondition,
  type NotificationKind,
  type NotificationPreferences,
} from "../shared/types/notifications";

const STORAGE_KEY = "aura-notification-preferences-v1";

interface NotificationPreferencesState {
  preferences: NotificationPreferences;
  setEnabled: (enabled: boolean) => void;
  setDesktopEnabled: (enabled: boolean) => void;
  setInAppEnabled: (enabled: boolean) => void;
  setBrowserEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setCondition: (condition: NotificationCondition) => void;
  setTypeEnabled: (kind: NotificationKind, enabled: boolean) => void;
  reset: () => void;
}

export const useNotificationPreferencesStore = create<NotificationPreferencesState>()(
  (set, get) => ({
    preferences: loadPreferences(),
    setEnabled: (enabled) => updatePreferences(set, get, { enabled }),
    setDesktopEnabled: (desktopEnabled) =>
      updatePreferences(set, get, { desktopEnabled }),
    setInAppEnabled: (inAppEnabled) => updatePreferences(set, get, { inAppEnabled }),
    setBrowserEnabled: (browserEnabled) =>
      updatePreferences(set, get, { browserEnabled }),
    setSoundEnabled: (soundEnabled) => updatePreferences(set, get, { soundEnabled }),
    setCondition: (condition) => updatePreferences(set, get, { condition }),
    setTypeEnabled: (kind, enabled) => {
      const preferences = {
        ...get().preferences,
        types: {
          ...get().preferences.types,
          [kind]: enabled,
        },
      };
      persistPreferences(preferences);
      set({ preferences });
    },
    reset: () => {
      const preferences = defaultNotificationPreferences();
      persistPreferences(preferences);
      set({ preferences });
    },
  }),
);

function updatePreferences(
  set: (state: Partial<NotificationPreferencesState>) => void,
  get: () => NotificationPreferencesState,
  patch: Partial<NotificationPreferences>,
): void {
  const preferences = { ...get().preferences, ...patch };
  persistPreferences(preferences);
  set({ preferences });
}

function loadPreferences(): NotificationPreferences {
  const defaults = defaultNotificationPreferences();
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      ...defaults,
      ...parsed,
      condition:
        parsed.condition === "always" || parsed.condition === "unfocused"
          ? parsed.condition
          : defaults.condition,
      types: {
        ...defaults.types,
        ...(typeof parsed.types === "object" && parsed.types ? parsed.types : {}),
      },
    };
  } catch {
    return defaults;
  }
}

function persistPreferences(preferences: NotificationPreferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are non-critical; ignore quota/private-mode failures.
  }
}
