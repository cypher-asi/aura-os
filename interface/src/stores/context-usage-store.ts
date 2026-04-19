import { create } from "zustand";

interface ContextUsageState {
  usageByStreamKey: Record<string, number>;
  /**
   * Per-streamKey "reset pending" sentinel. Set by {@link markResetPending}
   * when the user clicks "New session". While `true`, hydration hooks MUST
   * skip seeding the store from server-side session data so a stale latest
   * session (e.g. the reset API call failed, or storage hasn't yet surfaced
   * the freshly-created empty session) doesn't resurrect the old value.
   *
   * The sentinel clears automatically on the next `setContextUtilization`
   * call for that stream key, which happens when the first
   * `AssistantMessageEnd` of the new session arrives from the harness.
   */
  resetPendingByStreamKey: Record<string, true>;
  setContextUtilization: (key: string, value: number) => void;
  clearContextUtilization: (key: string) => void;
  markResetPending: (key: string) => void;
  isResetPending: (key: string) => boolean;
}

export const useContextUsageStore = create<ContextUsageState>((set, get) => ({
  usageByStreamKey: {},
  resetPendingByStreamKey: {},
  setContextUtilization: (key, value) =>
    set((state) => {
      const { [key]: _, ...resetRest } = state.resetPendingByStreamKey;
      return {
        usageByStreamKey: { ...state.usageByStreamKey, [key]: value },
        resetPendingByStreamKey: resetRest,
      };
    }),
  clearContextUtilization: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.usageByStreamKey;
      return { usageByStreamKey: rest };
    }),
  markResetPending: (key) =>
    set((state) => ({
      resetPendingByStreamKey: { ...state.resetPendingByStreamKey, [key]: true },
    })),
  isResetPending: (key) => Boolean(get().resetPendingByStreamKey[key]),
}));

export function useContextUtilization(streamKey: string): number | undefined {
  return useContextUsageStore(
    (state) => state.usageByStreamKey[streamKey],
  );
}
