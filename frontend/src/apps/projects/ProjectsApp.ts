import { FolderOpen } from "lucide-react";
import { ProjectList } from "../../components/ProjectList";
import { SharedMainPanel } from "../../components/SharedMainPanel";
import {
  SidekickContent,
  SidekickTaskbar,
  SidekickHeader,
} from "../../components/Sidekick";
import { PreviewContent, PreviewHeader } from "../../components/Preview";
import type { AuraApp } from "../types";

export const ProjectsApp: AuraApp = {
  id: "projects",
  label: "Projects",
  icon: FolderOpen,
  basePath: "/projects",
  LeftPanel: ProjectList,
  MainPanel: SharedMainPanel,
  ResponsiveControls: ProjectList,
  SidekickPanel: SidekickContent,
  SidekickTaskbar: SidekickTaskbar,
  SidekickHeader: SidekickHeader,
  PreviewPanel: PreviewContent,
  PreviewHeader: PreviewHeader,
  searchPlaceholder: "",
};
