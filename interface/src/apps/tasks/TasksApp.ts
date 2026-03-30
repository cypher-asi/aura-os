import { Check } from "lucide-react";
import { TasksProjectList } from "./components/TasksProjectList";
import { TasksMainPanel } from "./components/TasksMainPanel";
import { SidekickContent } from "../../components/SidekickContent";
import { SidekickTaskbar } from "../../components/SidekickTaskbar";
import { SidekickHeader } from "../../components/SidekickHeader";
import { PreviewContent, PreviewHeader } from "../../components/Preview";
import type { AuraApp } from "../types";

export const TasksApp: AuraApp = {
  id: "tasks",
  label: "Tasks",
  icon: Check,
  basePath: "/tasks",
  LeftPanel: TasksProjectList,
  MainPanel: TasksMainPanel,
  ResponsiveControls: TasksProjectList,
  SidekickPanel: SidekickContent,
  SidekickTaskbar: SidekickTaskbar,
  SidekickHeader: SidekickHeader,
  PreviewPanel: PreviewContent,
  PreviewHeader: PreviewHeader,
  searchPlaceholder: "Search Tasks...",
};
