import { Clock } from "lucide-react";
import { CronJobList } from "./components/CronJobList";
import { CronMainPanel } from "./components/CronMainPanel";
import { CronSidekickTaskbar } from "./components/CronSidekickTaskbar";
import { CronSidekickContent } from "./components/CronSidekickContent";
import { CronProvider } from "./components/CronProvider";
import type { AuraApp } from "../types";

export const CronApp: AuraApp = {
  id: "cron",
  label: "Cron Jobs",
  icon: Clock,
  basePath: "/cron",
  LeftPanel: CronJobList,
  MainPanel: CronMainPanel,
  ResponsiveControls: CronJobList,
  SidekickPanel: CronSidekickContent,
  SidekickTaskbar: CronSidekickTaskbar,
  Provider: CronProvider,
  searchPlaceholder: "Search Cron Jobs...",
};
