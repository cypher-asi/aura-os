import type { ReactNode } from "react";
import { Bot, Building2, Globe, UserCheck } from "lucide-react";
import type { LeaderboardFilter } from "./mockData";

export const LEADERBOARD_FILTERS: { id: LeaderboardFilter; label: string; icon: ReactNode }[] = [
  { id: "my-agents", label: "My Agents", icon: <Bot size={14} /> },
  { id: "organization", label: "Organization", icon: <Building2 size={14} /> },
  { id: "following", label: "Following", icon: <UserCheck size={14} /> },
  { id: "everything", label: "Everything", icon: <Globe size={14} /> },
];
