import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useEventStore } from "./event-store";
import { EventType } from "../shared/types/aura-events";
import { queryClient } from "../shared/lib/query-client";
import {
  leaderboardEntriesQueryOptions,
  leaderboardQueryKeys,
  type LeaderboardUser,
  type TimePeriod,
} from "../queries/leaderboard-queries";

export type { LeaderboardUser, TimePeriod } from "../queries/leaderboard-queries";

interface LeaderboardState {
  period: TimePeriod;
  selectedUserId: string | null;
  entries: LeaderboardUser[];
  loading: boolean;

  setPeriod: (p: TimePeriod) => void;
  selectUser: (id: string | null) => void;
  fetchEntries: () => Promise<void>;
  init: () => void;
}

let _initialized = false;
let _fetchId = 0;

export const useLeaderboardStore = create<LeaderboardState>()((set, get) => ({
  period: "all",
  selectedUserId: null,
  entries: [],
  loading: true,

  setPeriod: (p) => {
    set({ period: p });
    if (_initialized) get().fetchEntries();
  },

  selectUser: (id) => set({ selectedUserId: id }),

  fetchEntries: async () => {
    const id = ++_fetchId;
    set({ loading: true });
    const { period } = get();
    try {
      const data = await queryClient.fetchQuery({
        ...leaderboardEntriesQueryOptions(period),
        staleTime: 0,
      });
      if (id !== _fetchId) return;
      set({ entries: data });
    } catch {
      if (id !== _fetchId) return;
      set({ entries: [] });
    } finally {
      if (id === _fetchId) set({ loading: false });
    }
  },

  init: () => {
    if (_initialized) return;
    _initialized = true;
    get().fetchEntries();
  },
}));

let _refreshInterval: ReturnType<typeof setInterval> | null = null;

useEventStore.getState().subscribe(EventType.NetworkEvent, (event) => {
  if (!_initialized) return;
  const payload = event.content?.payload;
  if (!payload) return;
  const wsType = (payload.type as string) ?? "";
  if (wsType === "activity.new") {
    void queryClient.invalidateQueries({ queryKey: leaderboardQueryKeys.root });
    void useLeaderboardStore.getState().fetchEntries();
  }
});

export function startLeaderboardRefresh() {
  if (_refreshInterval) return;
  _refreshInterval = setInterval(() => {
    if (_initialized) {
      useLeaderboardStore.getState().fetchEntries();
    }
  }, 60_000);
}

export function stopLeaderboardRefresh() {
  if (_refreshInterval) {
    clearInterval(_refreshInterval);
    _refreshInterval = null;
  }
}

export function useLeaderboard() {
  return useLeaderboardStore(
    useShallow((s) => ({
      period: s.period,
      setPeriod: s.setPeriod,
      selectedUserId: s.selectedUserId,
      selectUser: s.selectUser,
      entries: s.entries,
      loading: s.loading,
    })),
  );
}
