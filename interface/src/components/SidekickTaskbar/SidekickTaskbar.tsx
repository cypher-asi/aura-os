import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import type { MenuItem } from "@cypher-asi/zui";
import {
  Archive,
  Info,
  File,
  Check,
  ScrollText,
  BarChart3,
  Monitor,
  FolderClosed,
  Play,
  Plus,
  Terminal,
} from "lucide-react";
import { useSidekickStore, type SidekickTab } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { SidekickTabBar, type TabItem } from "../SidekickTabBar";

const TAB_ICONS: TabItem[] = [
  { id: "terminal", icon: <Terminal size={16} />, title: "Terminal" },
  { id: "run", icon: <Play size={16} />, title: "Run" },
  { id: "specs", icon: <File size={16} />, title: "Specs" },
  { id: "tasks", icon: <Check size={16} />, title: "Tasks" },
  { id: "stats", icon: <BarChart3 size={16} />, title: "Stats" },
  { id: "log", icon: <ScrollText size={16} />, title: "Log" },
  { id: "sessions", icon: <Monitor size={16} />, title: "Sessions" },
  { id: "files", icon: <FolderClosed size={16} />, title: "Files" },
  { id: "new-terminal", icon: <Plus size={16} />, title: "New terminal", kind: "action" },
];

export function SidekickTaskbar() {
  const { activeTab, setActiveTab, showInfo, toggleInfo } = useSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      showInfo: s.showInfo,
      toggleInfo: s.toggleInfo,
    })),
  );
  const ctx = useProjectActions();
  const { features } = useAuraCapabilities();
  const addTerminal = useTerminalPanelStore((s) => s.addTerminal);
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath } = useTerminalTarget({ projectId, agentInstanceId });
  const canBrowseLocal = features.linkedWorkspace && !remoteAgentId && Boolean(workspacePath);
  const canBrowseRemote = Boolean(remoteAgentId) && Boolean(remoteWorkspacePath);
  const canBrowseFiles = canBrowseLocal || canBrowseRemote;

  useEffect(() => {
    if (!canBrowseFiles && activeTab === "files") {
      setActiveTab("tasks");
    }
  }, [activeTab, canBrowseFiles, setActiveTab]);

  if (showInfo) return null;

  const project = ctx?.project;
  const handleArchive = ctx?.handleArchive;
  const visibleTabs = canBrowseFiles ? TAB_ICONS : TAB_ICONS.filter((tab) => tab.id !== "files");

  const actions = useMemo<MenuItem[]>(() => {
    if (!project) return [];
    return [
      ...(project.current_status !== "archived"
        ? [{ id: "archive", label: "Archive", icon: <Archive size={14} /> }]
        : []),
      { id: "info", label: "Project Info", icon: <Info size={14} /> },
    ];
  }, [project]);

  const handleAction = (id: string) => {
    if (id === "archive") handleArchive?.();
    if (id === "info") toggleInfo("Project Info", null);
  };

  const handleInlineAction = (id: string) => {
    if (id !== "new-terminal") return;
    addTerminal();
    setActiveTab("terminal");
  };

  return (
    <SidekickTabBar
      tabs={visibleTabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as SidekickTab)}
      onInlineAction={handleInlineAction}
      actions={actions}
      onAction={handleAction}
      alwaysShowMore={!!project}
    />
  );
}
