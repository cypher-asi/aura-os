import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";

export type TimePeriod = "all" | "month" | "week" | "day";

export interface LeaderboardUser {
  id: string;
  name: string;
  avatarUrl?: string;
  profileId?: string;
  type: "user" | "agent";
  tokens: number;
  estimatedCostUsd: number;
  eventCount: number;
}
import { useEventStore } from "./event-store";
import { EventType } from "../types/aura-events";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const data = await api.leaderboard.get(period);
      if (id !== _fetchId) return;
      set({
        entries: data.map((e) => ({
          id: e.profile_id,
          name:
            e.display_name && !UUID_RE.test(e.display_name)
              ? e.display_name
              : e.profile_type === "agent"
                ? "Unnamed Agent"
                : "Unknown",
          avatarUrl: e.avatar_url ?? undefined,
          profileId: e.profile_id,
          type: (e.profile_type === "agent" ? "agent" : "user") as "user" | "agent",
          tokens: typeof e.tokens_used === "number" ? e.tokens_used : 0,
          estimatedCostUsd: typeof e.estimated_cost_usd === "number" ? e.estimated_cost_usd : 0,
          eventCount: typeof e.event_count === "number" ? e.event_count : 0,
        })),
      });
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
    useLeaderboardStore.getState().fetchEntries();
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
