export type TimePeriod = "all" | "month" | "week";

export type LeaderboardFilter = "my-agents" | "organization" | "following" | "everything";

export interface LeaderboardUser {
  id: string;
  name: string;
  avatarUrl?: string;
  type: "user" | "agent";
  tokens: number;
  cost: number;
  commits: number;
  agents: number;
}

const CURRENT_USER = "real-n3o";

const allTimeData: LeaderboardUser[] = [
  { id: "u1", name: "Alice Chen", type: "user", tokens: 4_821_300, cost: 62.68, commits: 312, agents: 8 },
  { id: "u2", name: "Marcus Webb", type: "user", tokens: 3_540_900, cost: 46.03, commits: 287, agents: 6 },
  { id: "u3", name: "Priya Sharma", type: "user", tokens: 2_910_400, cost: 37.84, commits: 245, agents: 7 },
  { id: "a1", name: "Atlas", type: "agent", tokens: 2_650_800, cost: 34.46, commits: 230, agents: 0 },
  { id: "u4", name: "Jordan Blake", type: "user", tokens: 2_104_700, cost: 27.36, commits: 198, agents: 5 },
  { id: "a2", name: "Cipher", type: "agent", tokens: 1_980_500, cost: 25.75, commits: 185, agents: 0 },
  { id: "u5", name: "Tomoko Sato", type: "user", tokens: 1_875_200, cost: 24.38, commits: 176, agents: 4 },
  { id: "a3", name: "Nova", type: "agent", tokens: 1_720_300, cost: 22.36, commits: 162, agents: 0 },
  { id: "u6", name: "Leo Martínez", type: "user", tokens: 1_632_100, cost: 21.22, commits: 154, agents: 5 },
  { id: "u7", name: "Ava Okonkwo", type: "user", tokens: 1_280_600, cost: 16.65, commits: 132, agents: 3 },
  { id: "u8", name: "Ethan Novak", type: "user", tokens: 984_300, cost: 12.80, commits: 97, agents: 3 },
  { id: "u9", name: "Sofia Petrov", type: "user", tokens: 721_500, cost: 9.38, commits: 68, agents: 2 },
  { id: "u10", name: "Kai Tanaka", type: "user", tokens: 415_200, cost: 5.40, commits: 41, agents: 1 },
];

const monthData: LeaderboardUser[] = [
  { id: "a1", name: "Atlas", type: "agent", tokens: 640_200, cost: 8.32, commits: 56, agents: 0 },
  { id: "u3", name: "Priya Sharma", type: "user", tokens: 620_100, cost: 8.06, commits: 54, agents: 7 },
  { id: "u1", name: "Alice Chen", type: "user", tokens: 580_400, cost: 7.55, commits: 48, agents: 8 },
  { id: "a2", name: "Cipher", type: "agent", tokens: 490_300, cost: 6.37, commits: 42, agents: 0 },
  { id: "u5", name: "Tomoko Sato", type: "user", tokens: 412_300, cost: 5.36, commits: 39, agents: 4 },
  { id: "u2", name: "Marcus Webb", type: "user", tokens: 395_800, cost: 5.14, commits: 35, agents: 6 },
  { id: "a3", name: "Nova", type: "agent", tokens: 350_100, cost: 4.55, commits: 30, agents: 0 },
  { id: "u6", name: "Leo Martínez", type: "user", tokens: 310_200, cost: 4.03, commits: 28, agents: 5 },
  { id: "u4", name: "Jordan Blake", type: "user", tokens: 274_600, cost: 3.57, commits: 22, agents: 5 },
  { id: "u8", name: "Ethan Novak", type: "user", tokens: 198_400, cost: 2.58, commits: 19, agents: 3 },
  { id: "u7", name: "Ava Okonkwo", type: "user", tokens: 145_300, cost: 1.89, commits: 14, agents: 3 },
  { id: "u9", name: "Sofia Petrov", type: "user", tokens: 102_700, cost: 1.34, commits: 11, agents: 2 },
  { id: "u10", name: "Kai Tanaka", type: "user", tokens: 58_900, cost: 0.77, commits: 6, agents: 1 },
];

const weekData: LeaderboardUser[] = [
  { id: "a1", name: "Atlas", type: "agent", tokens: 158_400, cost: 2.06, commits: 16, agents: 0 },
  { id: "u5", name: "Tomoko Sato", type: "user", tokens: 142_800, cost: 1.86, commits: 14, agents: 4 },
  { id: "u1", name: "Alice Chen", type: "user", tokens: 128_500, cost: 1.67, commits: 12, agents: 8 },
  { id: "u3", name: "Priya Sharma", type: "user", tokens: 115_200, cost: 1.50, commits: 11, agents: 7 },
  { id: "a2", name: "Cipher", type: "agent", tokens: 108_700, cost: 1.41, commits: 10, agents: 0 },
  { id: "u6", name: "Leo Martínez", type: "user", tokens: 98_400, cost: 1.28, commits: 9, agents: 5 },
  { id: "a3", name: "Nova", type: "agent", tokens: 92_100, cost: 1.20, commits: 8, agents: 0 },
  { id: "u2", name: "Marcus Webb", type: "user", tokens: 87_100, cost: 1.13, commits: 8, agents: 6 },
  { id: "u4", name: "Jordan Blake", type: "user", tokens: 64_300, cost: 0.84, commits: 5, agents: 5 },
  { id: "u8", name: "Ethan Novak", type: "user", tokens: 51_200, cost: 0.67, commits: 5, agents: 3 },
  { id: "u9", name: "Sofia Petrov", type: "user", tokens: 32_100, cost: 0.42, commits: 3, agents: 2 },
  { id: "u7", name: "Ava Okonkwo", type: "user", tokens: 24_600, cost: 0.32, commits: 2, agents: 3 },
  { id: "u10", name: "Kai Tanaka", type: "user", tokens: 11_800, cost: 0.15, commits: 1, agents: 1 },
];

const dataByPeriod: Record<TimePeriod, LeaderboardUser[]> = {
  all: allTimeData,
  month: monthData,
  week: weekData,
};

function applyFilter(users: LeaderboardUser[], filter: LeaderboardFilter): LeaderboardUser[] {
  switch (filter) {
    case "my-agents":
      return users.filter((u) => u.type === "agent");
    case "following":
      return users.filter((u) => u.name === CURRENT_USER);
    case "organization":
    case "everything":
    default:
      return users;
  }
}

export function getLeaderboard(period: TimePeriod, filter: LeaderboardFilter = "everything"): LeaderboardUser[] {
  return applyFilter(dataByPeriod[period], filter);
}
