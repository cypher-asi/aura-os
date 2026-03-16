import { createContext, useContext, useState, useMemo } from "react";
import type { ReactNode } from "react";
import type { TimePeriod, LeaderboardFilter } from "./mockData";

interface LeaderboardContextValue {
  period: TimePeriod;
  setPeriod: (p: TimePeriod) => void;
  filter: LeaderboardFilter;
  setFilter: (f: LeaderboardFilter) => void;
}

const LeaderboardCtx = createContext<LeaderboardContextValue | null>(null);

export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<TimePeriod>("all");
  const [filter, setFilter] = useState<LeaderboardFilter>("everything");

  const value = useMemo(() => ({ period, setPeriod, filter, setFilter }), [period, filter]);

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
