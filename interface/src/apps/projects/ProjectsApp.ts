import { FolderOpen } from "lucide-react";
import { ProjectList } from "../../components/ProjectList";
import { ProjectsNav } from "../../components/ProjectsNav";
import { SharedMainPanel } from "../../components/SharedMainPanel";
import { SidekickContent } from "../../components/SidekickContent";
import { SidekickTaskbar } from "../../components/SidekickTaskbar";
import { PreviewContent, PreviewHeader } from "../../components/Preview";
import type { AuraApp } from "../types";

export const ProjectsApp: AuraApp = {
  id: "projects",
  label: "Projects",
  icon: FolderOpen,
  basePath: "/projects",
  LeftPanel: ProjectsNav,
  DesktopLeftMenuPane: ProjectsNav,
  MainPanel: SharedMainPanel,
  ResponsiveControls: ProjectList,
  SidekickPanel: SidekickContent,
  SidekickTaskbar: SidekickTaskbar,
  PreviewPanel: PreviewContent,
  PreviewHeader: PreviewHeader,
  searchPlaceholder: "Search",
};
