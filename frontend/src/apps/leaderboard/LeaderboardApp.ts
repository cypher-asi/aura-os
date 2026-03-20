import { Gem } from "lucide-react";
import { LeaderboardSidebar } from "./LeaderboardSidebar";
import { LeaderboardMainPanel } from "./LeaderboardMainPanel";
import { LeaderboardSidekickPanel } from "./LeaderboardSidekickPanel";
import { LeaderboardProvider } from "./LeaderboardContext";
import type { AuraApp } from "../types";

export const LeaderboardApp: AuraApp = {
  id: "leaderboard",
  label: "Leaderboard",
  icon: Gem,
  basePath: "/leaderboard",
  LeftPanel: LeaderboardSidebar,
  MainPanel: LeaderboardMainPanel,
  ResponsiveControls: LeaderboardSidebar,
  SidekickPanel: LeaderboardSidekickPanel,
  Provider: LeaderboardProvider,
};
