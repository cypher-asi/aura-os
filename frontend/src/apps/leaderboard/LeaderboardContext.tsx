/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import type { ReactNode } from "react";
import type { TimePeriod, LeaderboardFilter, LeaderboardUser } from "./mockData";
import { api } from "../../api/client";
import { useOrgStore } from "../../stores/org-store";

interface LeaderboardContextValue {
  period: TimePeriod;
  setPeriod: (p: TimePeriod) => void;
  filter: LeaderboardFilter;
  setFilter: (f: LeaderboardFilter) => void;
  selectedUserId: string | null;
  selectUser: (id: string | null) => void;
  entries: LeaderboardUser[];
  loading: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LeaderboardCtx = createContext<LeaderboardContextValue | null>(null);

export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<TimePeriod>("all");
  const [filter, setFilter] = useState<LeaderboardFilter>("everything");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const activeOrg = useOrgStore((s) => s.activeOrg);

  const selectUser = useCallback((id: string | null) => setSelectedUserId(id), []);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => setLoading(true));
    api.leaderboard
      .get(period, activeOrg?.org_id)
      .then((data) => {
        if (cancelled) return;
        setEntries(
          data.map((e) => ({
            id: e.profile_id,
            name: e.display_name && !UUID_RE.test(e.display_name)
              ? e.display_name
              : e.profile_type === "agent" ? "Unnamed Agent" : "Unknown",
            avatarUrl: e.avatar_url ?? undefined,
            profileId: e.profile_id,
            type: (e.profile_type === "agent" ? "agent" : "user") as "user" | "agent",
            tokens: e.tokens_used,
            estimatedCostUsd: e.estimated_cost_usd,
            eventCount: e.event_count,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [period, activeOrg?.org_id]);

  const value = useMemo(
    () => ({ period, setPeriod, filter, setFilter, selectedUserId, selectUser, entries, loading }),
    [period, filter, selectedUserId, selectUser, entries, loading],
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
