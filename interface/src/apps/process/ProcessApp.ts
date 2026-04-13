import { Cpu } from "lucide-react";
import { ProcessList } from "./components/ProcessList";
import { ProcessMainPanel } from "./components/ProcessMainPanel";
import { ProcessSidekickTaskbar } from "./components/ProcessSidekickTaskbar";
import { ProcessSidekickContent } from "./components/ProcessSidekickContent/index";
import { ProcessProvider } from "./components/ProcessProvider";
import type { AuraApp } from "../types";

export const ProcessApp: AuraApp = {
  id: "process",
  label: "Processes",
  icon: Cpu,
  basePath: "/process",
  LeftPanel: ProcessList,
  DesktopLeftMenuPane: ProcessList,
  MainPanel: ProcessMainPanel,
  ResponsiveControls: ProcessList,
  SidekickPanel: ProcessSidekickContent,
  SidekickTaskbar: ProcessSidekickTaskbar,
  Provider: ProcessProvider,
  searchPlaceholder: "Search",
};
