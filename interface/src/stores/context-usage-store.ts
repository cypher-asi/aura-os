import { create } from "zustand";

interface ContextUsageState {
  usageByStreamKey: Record<string, number>;
  setContextUtilization: (key: string, value: number) => void;
  clearContextUtilization: (key: string) => void;
}

export const useContextUsageStore = create<ContextUsageState>((set) => ({
  usageByStreamKey: {},
  setContextUtilization: (key, value) =>
    set((state) => ({
      usageByStreamKey: { ...state.usageByStreamKey, [key]: value },
    })),
  clearContextUtilization: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.usageByStreamKey;
      return { usageByStreamKey: rest };
    }),
}));

export function useContextUtilization(streamKey: string): number | undefined {
  return useContextUsageStore(
    (state) => state.usageByStreamKey[streamKey],
  );
}
