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

/**
 * Factory that creates the common tab + preview-stack state and actions
 * shared across all sidekick stores. `canGoBack` is derived from the
 * preview history length and updated on every stack mutation.
 */
export function createSidekickSlice<Tab extends string, Preview = unknown>(
  defaultTab: Tab,
  set: (partial: Partial<SidekickSliceState<Tab, Preview>>) => void,
  get: () => SidekickSliceState<Tab, Preview>,
): SidekickSliceState<Tab, Preview> {
  return {
    activeTab: defaultTab,
    previewItem: null,
    previewHistory: [],
    canGoBack: false,

    setActiveTab: (tab: Tab) =>
      set({ activeTab: tab, previewItem: null, previewHistory: [], canGoBack: false }),

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
