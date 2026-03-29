export type TimePeriod = "all" | "month" | "week" | "day";

export type LeaderboardFilter = "my-agents" | "organization" | "following" | "everything";

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
