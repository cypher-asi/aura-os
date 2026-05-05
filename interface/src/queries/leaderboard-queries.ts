import { queryOptions, useQuery } from "@tanstack/react-query";
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

type LeaderboardEntryDto = Awaited<ReturnType<typeof api.leaderboard.get>>[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const leaderboardQueryKeys = {
  root: ["leaderboard"] as const,
  entries: (period: TimePeriod) => ["leaderboard", "entries", period] as const,
};

function displayNameForEntry(entry: LeaderboardEntryDto): string {
  if (entry.display_name && !UUID_RE.test(entry.display_name)) {
    return entry.display_name;
  }
  return entry.profile_type === "agent" ? "Unnamed Agent" : "Unknown";
}

export function mapLeaderboardEntries(
  entries: LeaderboardEntryDto[],
): LeaderboardUser[] {
  return entries
    .map((entry): LeaderboardUser => ({
      id: entry.profile_id,
      name: displayNameForEntry(entry),
      avatarUrl: entry.avatar_url ?? undefined,
      profileId: entry.profile_id,
      type: entry.profile_type === "agent" ? "agent" : "user",
      tokens: typeof entry.tokens_used === "number" ? entry.tokens_used : 0,
      estimatedCostUsd:
        typeof entry.estimated_cost_usd === "number"
          ? entry.estimated_cost_usd
          : 0,
      eventCount: typeof entry.event_count === "number" ? entry.event_count : 0,
    }))
    .sort((a, b) => {
      if (b.estimatedCostUsd !== a.estimatedCostUsd) {
        return b.estimatedCostUsd - a.estimatedCostUsd;
      }
      return b.tokens - a.tokens;
    });
}

export function leaderboardEntriesQueryOptions(period: TimePeriod) {
  return queryOptions({
    queryKey: leaderboardQueryKeys.entries(period),
    queryFn: async (): Promise<LeaderboardUser[]> =>
      mapLeaderboardEntries(await api.leaderboard.get(period)),
  });
}

export function useLeaderboardEntries(period: TimePeriod) {
  return useQuery(leaderboardEntriesQueryOptions(period));
}
