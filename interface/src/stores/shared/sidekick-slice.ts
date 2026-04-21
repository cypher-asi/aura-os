export interface SidekickSliceState<Tab extends string, Preview = unknown> {
  activeTab: Tab;
  previewItem: Preview | null;
  previewHistory: Preview[];
  canGoBack: boolean;

  setActiveTab: (tab: Tab) => void;
  pushPreview: (item: Preview) => void;
  popPreview: () => void;
  clearPreviews: () => void;
}

export interface SidekickPersistence<Tab extends string> {
  /** localStorage key that holds the serialized active tab. */
  storageKey: string;
  /** Guard that validates a raw string against the store's tab union. */
  isValidTab: (value: string) => value is Tab;
}

/**
 * Persist the given active tab under `storageKey`. Stores that override
 * `setActiveTab` call this alongside their own `set(...)` so that the
 * remembered tab stays in sync with the in-memory state.
 */
export function persistActiveTab(storageKey: string, tab: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, tab);
  } catch {
    // ignore storage failures (quota, disabled, etc.)
  }
}

function readPersistedTab<Tab extends string>(
  persistence: SidekickPersistence<Tab> | undefined,
): Tab | null {
  if (!persistence) return null;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(persistence.storageKey);
    if (raw && persistence.isValidTab(raw)) return raw;
  } catch {
    // ignore storage failures
  }
  return null;
}

/**
 * Factory that creates the common tab + preview-stack state and actions
 * shared across all sidekick stores. `canGoBack` is derived from the
 * preview history length and updated on every stack mutation.
 *
 * When `persistence` is provided, the initial `activeTab` is restored from
 * localStorage (falling back to `defaultTab` if absent/invalid) and the
 * default `setActiveTab` writes each new value back to localStorage.
 */
export function createSidekickSlice<Tab extends string, Preview = unknown>(
  defaultTab: Tab,
  set: (partial: Partial<SidekickSliceState<Tab, Preview>>) => void,
  get: () => SidekickSliceState<Tab, Preview>,
  persistence?: SidekickPersistence<Tab>,
): SidekickSliceState<Tab, Preview> {
  const initialTab = readPersistedTab<Tab>(persistence) ?? defaultTab;

  return {
    activeTab: initialTab,
    previewItem: null,
    previewHistory: [],
    canGoBack: false,

    setActiveTab: (tab: Tab) => {
      if (persistence) persistActiveTab(persistence.storageKey, tab);
      set({ activeTab: tab, previewItem: null, previewHistory: [], canGoBack: false });
    },

    pushPreview: (item: Preview) => {
      const { previewItem, previewHistory } = get();
      const newHistory = previewItem
        ? [...previewHistory, previewItem]
        : previewHistory;
      set({
        previewHistory: newHistory,
        previewItem: item,
        canGoBack: newHistory.length > 0,
      });
    },

    popPreview: () => {
      const { previewHistory } = get();
      if (previewHistory.length === 0) return;
      const history = [...previewHistory];
      const popped = history.pop()!;
      set({
        previewItem: popped,
        previewHistory: history,
        canGoBack: history.length > 0,
      });
    },

    clearPreviews: () =>
      set({ previewItem: null, previewHistory: [], canGoBack: false }),
  };
}
