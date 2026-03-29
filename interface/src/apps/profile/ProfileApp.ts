import { CircleUserRound } from "lucide-react";
import { ProfileList } from "./ProfileList";
import { ProfileMainPanel } from "./ProfileMainPanel";
import { ProfileSidekickPanel } from "./ProfileSidekickPanel";
import { ProfileSidekickHeader } from "./ProfileSidekickHeader";
import type { AuraApp } from "../types";

export const ProfileApp: AuraApp = {
  id: "profile",
  label: "Profile",
  icon: CircleUserRound,
  basePath: "/profile",
  LeftPanel: ProfileList,
  MainPanel: ProfileMainPanel,
  SidekickPanel: ProfileSidekickPanel,
  SidekickTaskbar: ProfileSidekickHeader,
  searchPlaceholder: "Filter Projects...",
};
