import { Check } from "lucide-react";
import { TasksProjectList } from "./components/TasksProjectList";
import { TasksMainPanel } from "./components/TasksMainPanel";
import { SidekickContent } from "../../components/SidekickContent";
import { SidekickTaskbar } from "../../components/SidekickTaskbar";
import { PreviewContent, PreviewHeader } from "../../components/Preview";
import type { AuraApp } from "../types";
import { TasksProvider } from "./components/TasksProvider";

export const TasksApp: AuraApp = {
  id: "tasks",
  label: "Tasks",
  icon: Check,
  basePath: "/tasks",
  LeftPanel: TasksProjectList,
  DesktopLeftMenuPane: TasksProjectList,
  MainPanel: TasksMainPanel,
  ResponsiveControls: TasksProjectList,
  SidekickPanel: SidekickContent,
  SidekickTaskbar: SidekickTaskbar,
  PreviewPanel: PreviewContent,
  PreviewHeader: PreviewHeader,
  Provider: TasksProvider,
  searchPlaceholder: "Search Tasks...",
};
