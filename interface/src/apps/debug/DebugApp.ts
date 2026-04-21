import { Bug } from "lucide-react";
import { DebugNav } from "./DebugNav";
import { DebugMainPanel } from "./DebugMainPanel";
import type { AuraAppModule } from "../types";

export const DebugApp: AuraAppModule = {
  id: "debug",
  label: "Debug",
  icon: Bug,
  basePath: "/debug",
  LeftPanel: DebugNav,
  MainPanel: DebugMainPanel,
  ResponsiveControls: DebugNav,
  searchPlaceholder: "Search runs",
};
