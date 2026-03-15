import { FolderOpen } from "lucide-react";
import { ProjectList } from "../../components/ProjectList";
import { ProjectMainPanel } from "./ProjectMainPanel";
import {
  SidekickContent,
  SidekickTaskbar,
  SidekickHeader,
} from "../../components/Sidekick";
import { PreviewContent, PreviewHeader } from "../../components/Preview";
import { ProjectsProvider } from "./ProjectsProvider";
import type { AuraApp } from "../types";

export const ProjectsApp: AuraApp = {
  id: "projects",
  label: "Projects",
  icon: FolderOpen,
  basePath: "/projects",
  LeftPanel: ProjectList,
  MainPanel: ProjectMainPanel,
  SidekickPanel: SidekickContent,
  SidekickTaskbar: SidekickTaskbar,
  SidekickHeader: SidekickHeader,
  PreviewPanel: PreviewContent,
  PreviewHeader: PreviewHeader,
  Provider: ProjectsProvider,
};
