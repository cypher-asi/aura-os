import { Bug } from "lucide-react";
import { DebugNav } from "./DebugNav";
import { DebugMainPanel } from "./DebugMainPanel";
import { DebugSidekickContent } from "./components/DebugSidekickContent";
import { DebugSidekickTaskbar } from "./components/DebugSidekickTaskbar";
import type { AuraAppModule } from "../types";

export const DebugApp: AuraAppModule = {
  id: "debug",
  label: "Debug",
  icon: Bug,
  basePath: "/debug",
  LeftPanel: DebugNav,
  DesktopLeftMenuPane: DebugNav,
  MainPanel: DebugMainPanel,
  ResponsiveControls: DebugNav,
  SidekickPanel: DebugSidekickContent,
  SidekickTaskbar: DebugSidekickTaskbar,
  searchPlaceholder: "Search projects",
};
