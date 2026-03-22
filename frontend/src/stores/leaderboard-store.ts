import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { TimePeriod, LeaderboardFilter, LeaderboardUser } from "../apps/leaderboard/mockData";
import { api } from "../api/client";
import { useOrgStore } from "./org-store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LeaderboardState {
  period: TimePeriod;
  filter: LeaderboardFilter;
  selectedUserId: string | null;
  entries: LeaderboardUser[];
  loading: boolean;

  setPeriod: (p: TimePeriod) => void;
  setFilter: (f: LeaderboardFilter) => void;
  selectUser: (id: string | null) => void;
  fetchEntries: () => Promise<void>;
  init: () => void;
}

let _initialized = false;
let _fetchId = 0;

export const useLeaderboardStore = create<LeaderboardState>()((set, get) => ({
  period: "all",
  filter: "everything",
  selectedUserId: null,
  entries: [],
  loading: true,

  setPeriod: (p) => {
    set({ period: p });
    if (_initialized) get().fetchEntries();
  },

  setFilter: (f) => {
    set({ filter: f });
  },

  selectUser: (id) => set({ selectedUserId: id }),

  fetchEntries: async () => {
    const id = ++_fetchId;
    set({ loading: true });
    const { period } = get();
    const orgId = useOrgStore.getState().activeOrg?.org_id;
    try {
      const data = await api.leaderboard.get(period, orgId);
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

let _prevOrgId: string | null = null;
useOrgStore.subscribe((state) => {
  if (!_initialized) return;
  const orgId = state.activeOrg?.org_id ?? null;
  if (orgId === _prevOrgId) return;
  _prevOrgId = orgId;
  useLeaderboardStore.getState().fetchEntries();
});

export function useLeaderboard() {
  return useLeaderboardStore(
    useShallow((s) => ({
      period: s.period,
      setPeriod: s.setPeriod,
      filter: s.filter,
      setFilter: s.setFilter,
      selectedUserId: s.selectedUserId,
      selectUser: s.selectUser,
      entries: s.entries,
      loading: s.loading,
    })),
  );
}
