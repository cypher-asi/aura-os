import { create } from "zustand";

export interface ContextUsageEntry {
  utilization: number;
  estimatedTokens?: number;
}

interface ContextUsageState {
  usageByStreamKey: Record<string, ContextUsageEntry>;
  /**
   * Cached utilization-per-token ratio derived from the last authoritative
   * `AssistantMessageEnd` payload. Used to project live utilization from
   * streaming token deltas so the Context pill updates mid-turn instead
   * of jumping only at turn boundaries.
   */
  utilPerTokenByStreamKey: Record<string, number>;
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
  setContextUtilization: (
    key: string,
    utilization: number,
    estimatedTokens?: number,
  ) => void;
  /**
   * Optimistically bump the estimated token count for a stream by
   * `tokensDelta`. Projects `utilization` from the cached per-token ratio
   * when available so the UI moves during a live turn. The next
   * `setContextUtilization` call reconciles the optimistic value with the
   * server-reported authoritative one.
   */
  bumpEstimatedTokens: (key: string, tokensDelta: number) => void;
  clearContextUtilization: (key: string) => void;
  markResetPending: (key: string) => void;
  isResetPending: (key: string) => boolean;
}

export const useContextUsageStore = create<ContextUsageState>((set, get) => ({
  usageByStreamKey: {},
  utilPerTokenByStreamKey: {},
  resetPendingByStreamKey: {},
  setContextUtilization: (key, utilization, estimatedTokens) =>
    set((state) => {
      const { [key]: _, ...resetRest } = state.resetPendingByStreamKey;
      const entry: ContextUsageEntry = { utilization };
      let nextRatios = state.utilPerTokenByStreamKey;
      if (
        typeof estimatedTokens === "number" &&
        Number.isFinite(estimatedTokens) &&
        estimatedTokens >= 0
      ) {
        entry.estimatedTokens = estimatedTokens;
        if (estimatedTokens > 0 && utilization > 0) {
          nextRatios = {
            ...state.utilPerTokenByStreamKey,
            [key]: utilization / estimatedTokens,
          };
        }
      }
      return {
        usageByStreamKey: { ...state.usageByStreamKey, [key]: entry },
        utilPerTokenByStreamKey: nextRatios,
        resetPendingByStreamKey: resetRest,
      };
    }),
  bumpEstimatedTokens: (key, tokensDelta) => {
    if (!Number.isFinite(tokensDelta) || tokensDelta <= 0) return;
    set((state) => {
      const prev = state.usageByStreamKey[key];
      const ratio = state.utilPerTokenByStreamKey[key];
      const prevTokens = prev?.estimatedTokens ?? 0;
      const nextTokens = prevTokens + tokensDelta;
      const prevUtil = prev?.utilization ?? 0;
      const projectedUtil = ratio ? Math.min(1, nextTokens * ratio) : prevUtil;
      // Only advance forward so we don't undo a larger authoritative
      // value that might have landed between deltas.
      const nextUtil = Math.max(prevUtil, projectedUtil);
      return {
        usageByStreamKey: {
          ...state.usageByStreamKey,
          [key]: { utilization: nextUtil, estimatedTokens: nextTokens },
        },
      };
    });
  },
  clearContextUtilization: (key) =>
    set((state) => {
      const { [key]: _usage, ...rest } = state.usageByStreamKey;
      const { [key]: _ratio, ...ratios } = state.utilPerTokenByStreamKey;
      return { usageByStreamKey: rest, utilPerTokenByStreamKey: ratios };
    }),
  markResetPending: (key) =>
    set((state) => ({
      resetPendingByStreamKey: { ...state.resetPendingByStreamKey, [key]: true },
    })),
  isResetPending: (key) => Boolean(get().resetPendingByStreamKey[key]),
}));

export function useContextUtilization(streamKey: string): number | undefined {
  return useContextUsageStore(
    (state) => state.usageByStreamKey[streamKey]?.utilization,
  );
}

export function useContextUsage(
  streamKey: string,
): ContextUsageEntry | undefined {
  return useContextUsageStore((state) => state.usageByStreamKey[streamKey]);
}

/**
 * Very rough char-to-token estimate used for live mid-turn bumps. 4 chars
 * per token is the widely cited heuristic for English + code; individual
 * tokenizers will disagree but the only consumer is a visual progress
 * pill, which `AssistantMessageEnd` later reconciles to the authoritative
 * server value.
 */
export function approxTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
