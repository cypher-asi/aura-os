export type TimePeriod = "all" | "month" | "week";

export type LeaderboardFilter = "my-agents" | "organization" | "following" | "everything";

export interface AgentContribution {
  agent: string;
  tokens: number;
  commits: number;
}

export interface LeaderboardUser {
  id: string;
  name: string;
  avatarUrl?: string;
  profileId?: string;
  type: "user" | "agent";
  tokens: number;
  commits: number;
  agents: number;
  breakdown: AgentContribution[];
}
function scaleEntry(u: LeaderboardUser, factor: number, jitter: number): LeaderboardUser {
  const j = () => 1 + (Math.sin(u.id.charCodeAt(1) * jitter) * 0.3);
  const f = factor * j();
  return {
    ...u,
    tokens: Math.round(u.tokens * f),
    commits: Math.max(1, Math.round(u.commits * f)),
    breakdown: u.breakdown.map((b) => ({
      ...b,
      tokens: Math.round(b.tokens * f),
      commits: Math.max(1, Math.round(b.commits * f)),
    })),
  };
}

function deriveData(source: LeaderboardUser[], factor: number, jitter: number): LeaderboardUser[] {
  return source
    .map((u) => scaleEntry(u, factor, jitter))
    .sort((a, b) => b.tokens - a.tokens);
}

const allTimeData: LeaderboardUser[] = [
  { id: "u1", name: "Alice Chen", type: "user", tokens: 4_821_300, commits: 312, agents: 4, breakdown: [
    { agent: "Atlas", tokens: 1_620_000, commits: 105 },
    { agent: "Cipher", tokens: 1_380_000, commits: 89 },
    { agent: "Nova", tokens: 1_021_300, commits: 66 },
    { agent: "Bolt", tokens: 800_000, commits: 52 },
  ]},
  { id: "u2", name: "Marcus Webb", type: "user", tokens: 3_540_900, commits: 287, agents: 4, breakdown: [
    { agent: "Cipher", tokens: 1_240_000, commits: 100 },
    { agent: "Atlas", tokens: 1_100_900, commits: 89 },
    { agent: "Nova", tokens: 700_000, commits: 57 },
    { agent: "Bolt", tokens: 500_000, commits: 41 },
  ]},
  { id: "u3", name: "Priya Sharma", type: "user", tokens: 2_910_400, commits: 245, agents: 3, breakdown: [
    { agent: "Nova", tokens: 1_210_400, commits: 102 },
    { agent: "Atlas", tokens: 950_000, commits: 80 },
    { agent: "Cipher", tokens: 750_000, commits: 63 },
  ]},
  { id: "a1", name: "Atlas", type: "agent", tokens: 2_650_800, commits: 230, agents: 0, breakdown: [
    { agent: "Atlas", tokens: 2_650_800, commits: 230 },
  ]},
  { id: "u4", name: "Jordan Blake", type: "user", tokens: 2_104_700, commits: 198, agents: 3, breakdown: [
    { agent: "Atlas", tokens: 840_000, commits: 79 },
    { agent: "Nova", tokens: 720_700, commits: 68 },
    { agent: "Cipher", tokens: 544_000, commits: 51 },
  ]},
  { id: "a2", name: "Cipher", type: "agent", tokens: 1_980_500, commits: 185, agents: 0, breakdown: [
    { agent: "Cipher", tokens: 1_980_500, commits: 185 },
  ]},
  { id: "u5", name: "Tomoko Sato", type: "user", tokens: 1_875_200, commits: 176, agents: 3, breakdown: [
    { agent: "Cipher", tokens: 680_200, commits: 64 },
    { agent: "Nova", tokens: 620_000, commits: 58 },
    { agent: "Atlas", tokens: 575_000, commits: 54 },
  ]},
  { id: "a3", name: "Nova", type: "agent", tokens: 1_720_300, commits: 162, agents: 0, breakdown: [
    { agent: "Nova", tokens: 1_720_300, commits: 162 },
  ]},
  { id: "u6", name: "Leo Martínez", type: "user", tokens: 1_632_100, commits: 154, agents: 3, breakdown: [
    { agent: "Atlas", tokens: 612_100, commits: 58 },
    { agent: "Cipher", tokens: 540_000, commits: 51 },
    { agent: "Nova", tokens: 480_000, commits: 45 },
  ]},
  { id: "u7", name: "Ava Okonkwo", type: "user", tokens: 1_480_600, commits: 142, agents: 3, breakdown: [
    { agent: "Nova", tokens: 580_600, commits: 56 },
    { agent: "Atlas", tokens: 500_000, commits: 48 },
    { agent: "Cipher", tokens: 400_000, commits: 38 },
  ]},
  { id: "u8", name: "Ethan Novak", type: "user", tokens: 1_384_300, commits: 134, agents: 3, breakdown: [
    { agent: "Cipher", tokens: 524_300, commits: 51 },
    { agent: "Atlas", tokens: 480_000, commits: 46 },
    { agent: "Nova", tokens: 380_000, commits: 37 },
  ]},
  { id: "u9", name: "Sofia Petrov", type: "user", tokens: 1_221_500, commits: 118, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 721_500, commits: 70 },
    { agent: "Nova", tokens: 500_000, commits: 48 },
  ]},
  { id: "u10", name: "Kai Tanaka", type: "user", tokens: 1_115_200, commits: 108, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 615_200, commits: 60 },
    { agent: "Bolt", tokens: 500_000, commits: 48 },
  ]},
  { id: "a4", name: "Bolt", type: "agent", tokens: 1_050_400, commits: 98, agents: 0, breakdown: [
    { agent: "Bolt", tokens: 1_050_400, commits: 98 },
  ]},
  { id: "u11", name: "Ravi Patel", type: "user", tokens: 982_100, commits: 95, agents: 3, breakdown: [
    { agent: "Atlas", tokens: 402_100, commits: 39 },
    { agent: "Cipher", tokens: 340_000, commits: 33 },
    { agent: "Nova", tokens: 240_000, commits: 23 },
  ]},
  { id: "u12", name: "Hannah Kim", type: "user", tokens: 948_700, commits: 91, agents: 2, breakdown: [
    { agent: "Nova", tokens: 548_700, commits: 53 },
    { agent: "Atlas", tokens: 400_000, commits: 38 },
  ]},
  { id: "u13", name: "Diego Reyes", type: "user", tokens: 912_300, commits: 88, agents: 3, breakdown: [
    { agent: "Cipher", tokens: 412_300, commits: 40 },
    { agent: "Atlas", tokens: 280_000, commits: 27 },
    { agent: "Bolt", tokens: 220_000, commits: 21 },
  ]},
  { id: "u14", name: "Ingrid Larsson", type: "user", tokens: 875_600, commits: 84, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 475_600, commits: 46 },
    { agent: "Nova", tokens: 400_000, commits: 38 },
  ]},
  { id: "u15", name: "Omar Farouk", type: "user", tokens: 841_200, commits: 81, agents: 3, breakdown: [
    { agent: "Nova", tokens: 341_200, commits: 33 },
    { agent: "Cipher", tokens: 280_000, commits: 27 },
    { agent: "Atlas", tokens: 220_000, commits: 21 },
  ]},
  { id: "u16", name: "Yuki Nakamura", type: "user", tokens: 798_400, commits: 77, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 448_400, commits: 43 },
    { agent: "Nova", tokens: 350_000, commits: 34 },
  ]},
  { id: "u17", name: "Chloe Durand", type: "user", tokens: 762_100, commits: 73, agents: 3, breakdown: [
    { agent: "Atlas", tokens: 312_100, commits: 30 },
    { agent: "Cipher", tokens: 250_000, commits: 24 },
    { agent: "Bolt", tokens: 200_000, commits: 19 },
  ]},
  { id: "u18", name: "Liam O'Brien", type: "user", tokens: 724_800, commits: 70, agents: 2, breakdown: [
    { agent: "Nova", tokens: 424_800, commits: 41 },
    { agent: "Atlas", tokens: 300_000, commits: 29 },
  ]},
  { id: "u19", name: "Amara Diallo", type: "user", tokens: 691_500, commits: 67, agents: 3, breakdown: [
    { agent: "Cipher", tokens: 291_500, commits: 28 },
    { agent: "Atlas", tokens: 220_000, commits: 21 },
    { agent: "Nova", tokens: 180_000, commits: 18 },
  ]},
  { id: "u20", name: "Felix Braun", type: "user", tokens: 658_200, commits: 63, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 358_200, commits: 34 },
    { agent: "Cipher", tokens: 300_000, commits: 29 },
  ]},
  { id: "u21", name: "real-n3o", type: "user", tokens: 625_400, commits: 60, agents: 3, breakdown: [
    { agent: "Atlas", tokens: 275_400, commits: 26 },
    { agent: "Nova", tokens: 200_000, commits: 19 },
    { agent: "Cipher", tokens: 150_000, commits: 15 },
  ]},
  { id: "u22", name: "Mia Johansson", type: "user", tokens: 598_100, commits: 57, agents: 2, breakdown: [
    { agent: "Nova", tokens: 348_100, commits: 33 },
    { agent: "Bolt", tokens: 250_000, commits: 24 },
  ]},
  { id: "u23", name: "Carlos Vega", type: "user", tokens: 571_800, commits: 55, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 321_800, commits: 31 },
    { agent: "Atlas", tokens: 250_000, commits: 24 },
  ]},
  { id: "u24", name: "Fatima Al-Rashid", type: "user", tokens: 542_300, commits: 52, agents: 3, breakdown: [
    { agent: "Atlas", tokens: 222_300, commits: 21 },
    { agent: "Nova", tokens: 180_000, commits: 17 },
    { agent: "Cipher", tokens: 140_000, commits: 14 },
  ]},
  { id: "u25", name: "Noah Fischer", type: "user", tokens: 518_700, commits: 50, agents: 2, breakdown: [
    { agent: "Nova", tokens: 298_700, commits: 29 },
    { agent: "Atlas", tokens: 220_000, commits: 21 },
  ]},
  { id: "u26", name: "Elena Voronova", type: "user", tokens: 491_200, commits: 47, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 271_200, commits: 26 },
    { agent: "Nova", tokens: 220_000, commits: 21 },
  ]},
  { id: "u27", name: "James Okafor", type: "user", tokens: 465_800, commits: 45, agents: 3, breakdown: [
    { agent: "Atlas", tokens: 205_800, commits: 20 },
    { agent: "Cipher", tokens: 150_000, commits: 14 },
    { agent: "Bolt", tokens: 110_000, commits: 11 },
  ]},
  { id: "u28", name: "Isla McAllister", type: "user", tokens: 438_400, commits: 42, agents: 2, breakdown: [
    { agent: "Nova", tokens: 258_400, commits: 25 },
    { agent: "Atlas", tokens: 180_000, commits: 17 },
  ]},
  { id: "u29", name: "Andrei Kozlov", type: "user", tokens: 412_100, commits: 40, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 232_100, commits: 22 },
    { agent: "Atlas", tokens: 180_000, commits: 18 },
  ]},
  { id: "u30", name: "Zara Hussain", type: "user", tokens: 388_700, commits: 37, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 218_700, commits: 21 },
    { agent: "Nova", tokens: 170_000, commits: 16 },
  ]},
  { id: "u31", name: "Lucas Ferreira", type: "user", tokens: 362_300, commits: 35, agents: 3, breakdown: [
    { agent: "Nova", tokens: 162_300, commits: 16 },
    { agent: "Cipher", tokens: 120_000, commits: 11 },
    { agent: "Atlas", tokens: 80_000, commits: 8 },
  ]},
  { id: "u32", name: "Anika Müller", type: "user", tokens: 341_800, commits: 33, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 191_800, commits: 18 },
    { agent: "Cipher", tokens: 150_000, commits: 15 },
  ]},
  { id: "u33", name: "Tariq Benson", type: "user", tokens: 318_400, commits: 31, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 178_400, commits: 17 },
    { agent: "Nova", tokens: 140_000, commits: 14 },
  ]},
  { id: "u34", name: "Sakura Ito", type: "user", tokens: 295_100, commits: 28, agents: 2, breakdown: [
    { agent: "Nova", tokens: 175_100, commits: 17 },
    { agent: "Atlas", tokens: 120_000, commits: 11 },
  ]},
  { id: "u35", name: "Viktor Lindqvist", type: "user", tokens: 274_600, commits: 26, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 154_600, commits: 15 },
    { agent: "Cipher", tokens: 120_000, commits: 11 },
  ]},
  { id: "u36", name: "Nadia Kowalski", type: "user", tokens: 252_300, commits: 24, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 142_300, commits: 14 },
    { agent: "Nova", tokens: 110_000, commits: 10 },
  ]},
  { id: "u37", name: "Samuel Achebe", type: "user", tokens: 231_800, commits: 22, agents: 1, breakdown: [
    { agent: "Atlas", tokens: 231_800, commits: 22 },
  ]},
  { id: "u38", name: "Camille Rousseau", type: "user", tokens: 215_400, commits: 21, agents: 2, breakdown: [
    { agent: "Nova", tokens: 125_400, commits: 12 },
    { agent: "Cipher", tokens: 90_000, commits: 9 },
  ]},
  { id: "u39", name: "Arjun Mehta", type: "user", tokens: 198_100, commits: 19, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 118_100, commits: 11 },
    { agent: "Nova", tokens: 80_000, commits: 8 },
  ]},
  { id: "u40", name: "Freya Andersen", type: "user", tokens: 182_700, commits: 18, agents: 1, breakdown: [
    { agent: "Cipher", tokens: 182_700, commits: 18 },
  ]},
  { id: "u41", name: "Rafael Moreno", type: "user", tokens: 168_300, commits: 16, agents: 2, breakdown: [
    { agent: "Nova", tokens: 98_300, commits: 9 },
    { agent: "Atlas", tokens: 70_000, commits: 7 },
  ]},
  { id: "u42", name: "Leila Nazari", type: "user", tokens: 152_800, commits: 15, agents: 2, breakdown: [
    { agent: "Atlas", tokens: 92_800, commits: 9 },
    { agent: "Cipher", tokens: 60_000, commits: 6 },
  ]},
  { id: "u43", name: "Patrick Byrne", type: "user", tokens: 138_400, commits: 13, agents: 1, breakdown: [
    { agent: "Nova", tokens: 138_400, commits: 13 },
  ]},
  { id: "u44", name: "Mei-Lin Chang", type: "user", tokens: 124_100, commits: 12, agents: 2, breakdown: [
    { agent: "Cipher", tokens: 74_100, commits: 7 },
    { agent: "Atlas", tokens: 50_000, commits: 5 },
  ]},
  { id: "u45", name: "David Osei", type: "user", tokens: 112_600, commits: 11, agents: 1, breakdown: [
    { agent: "Atlas", tokens: 112_600, commits: 11 },
  ]},
  { id: "u46", name: "Anna Bergström", type: "user", tokens: 98_200, commits: 9, agents: 2, breakdown: [
    { agent: "Nova", tokens: 58_200, commits: 5 },
    { agent: "Cipher", tokens: 40_000, commits: 4 },
  ]},
  { id: "u47", name: "Kofi Mensah", type: "user", tokens: 84_700, commits: 8, agents: 1, breakdown: [
    { agent: "Atlas", tokens: 84_700, commits: 8 },
  ]},
  { id: "u48", name: "Clara Rossi", type: "user", tokens: 71_300, commits: 7, agents: 1, breakdown: [
    { agent: "Cipher", tokens: 71_300, commits: 7 },
  ]},
  { id: "u49", name: "Hassan Yilmaz", type: "user", tokens: 58_800, commits: 6, agents: 1, breakdown: [
    { agent: "Nova", tokens: 58_800, commits: 6 },
  ]},
  { id: "u50", name: "Olivia Tran", type: "user", tokens: 42_100, commits: 4, agents: 1, breakdown: [
    { agent: "Atlas", tokens: 42_100, commits: 4 },
  ]},
];

const monthData = deriveData(allTimeData, 0.12, 7);
const weekData = deriveData(allTimeData, 0.03, 13);

const dataByPeriod: Record<TimePeriod, LeaderboardUser[]> = {
  all: allTimeData,
  month: monthData,
  week: weekData,
};

function applyFilter(
  users: LeaderboardUser[],
  filter: LeaderboardFilter,
  followedNames?: Set<string>,
): LeaderboardUser[] {
  switch (filter) {
    case "my-agents":
      return users.filter((u) => u.type === "agent");
    case "following":
      if (!followedNames || followedNames.size === 0) return [];
      return users.filter((u) => followedNames.has(u.name));
    case "organization":
    case "everything":
    default:
      return users;
  }
}

export function getLeaderboard(
  period: TimePeriod,
  filter: LeaderboardFilter = "everything",
  followedNames?: Set<string>,
): LeaderboardUser[] {
  return applyFilter(dataByPeriod[period], filter, followedNames);
}
