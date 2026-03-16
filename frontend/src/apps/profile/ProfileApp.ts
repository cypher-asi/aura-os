import { CircleUserRound } from "lucide-react";
import { ProfileList } from "./ProfileList";
import { ProfileMainPanel } from "./ProfileMainPanel";
import { ProfileSidekickPanel } from "./ProfileSidekickPanel";
import { ProfileSidekickHeader } from "./ProfileSidekickHeader";
import { ProfileProvider } from "./ProfileProvider";
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
  Provider: ProfileProvider,
  searchPlaceholder: "Search Projects...",
};
