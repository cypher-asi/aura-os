import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { TimePeriod, LeaderboardFilter } from "./mockData";

interface LeaderboardContextValue {
  period: TimePeriod;
  setPeriod: (p: TimePeriod) => void;
  filter: LeaderboardFilter;
  setFilter: (f: LeaderboardFilter) => void;
  selectedUserId: string | null;
  selectUser: (id: string | null) => void;
}

const LeaderboardCtx = createContext<LeaderboardContextValue | null>(null);

export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<TimePeriod>("all");
  const [filter, setFilter] = useState<LeaderboardFilter>("everything");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const selectUser = useCallback((id: string | null) => setSelectedUserId(id), []);

  const value = useMemo(
    () => ({ period, setPeriod, filter, setFilter, selectedUserId, selectUser }),
    [period, filter, selectedUserId, selectUser],
  );

  return (
    <LeaderboardCtx.Provider value={value}>{children}</LeaderboardCtx.Provider>
  );
}

export function useLeaderboard() {
  const ctx = useContext(LeaderboardCtx);
  if (!ctx)
    throw new Error("useLeaderboard must be used within LeaderboardProvider");
  return ctx;
}

export function useLeaderboardSidekickCollapsed() {
  const { selectedUserId } = useLeaderboard();
  return !selectedUserId;
}
