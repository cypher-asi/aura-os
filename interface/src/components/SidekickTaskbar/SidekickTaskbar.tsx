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
  SquareTerminal,
  Globe,
} from "lucide-react";
import { useSidekickStore, type SidekickTab } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useBrowserPanelStore } from "../../stores/browser-panel-store";
import { SidekickTabBar, type TabItem } from "../SidekickTabBar";
import { LoopProgress } from "../LoopProgress";
import {
  selectAgentInstanceActivity,
  selectProjectActivity,
  useLoopActivityStore,
} from "../../stores/loop-activity-store";
import { isLoopActivityActive } from "../../shared/types/aura-events";
import styles from "../Sidekick/Sidekick.module.css";

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
  const addBrowserInstance = useBrowserPanelStore((s) => s.addInstance);
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath } = useTerminalTarget({ projectId, agentInstanceId });
  const canBrowseLocal = features.linkedWorkspace && !remoteAgentId && Boolean(workspacePath);
  const canBrowseRemote = Boolean(remoteAgentId) && Boolean(remoteWorkspacePath);
  const canBrowseFiles = canBrowseLocal || canBrowseRemote;
  // Tasks tab lights up whenever ANY loop is open for this (project,
  // agent_instance) — this covers the live task runs in this project.
  // Run tab uses a project-wide scope so cross-agent activity inside
  // the same project also surfaces on the shared Run tab.
  const tasksActivity = useLoopActivityStore(
    useShallow((s) => selectAgentInstanceActivity(s, agentInstanceId ?? null)),
  );
  const runActivity = useLoopActivityStore(
    useShallow((s) => selectProjectActivity(s, projectId ?? null)),
  );
  const tasksActive = !!tasksActivity && isLoopActivityActive(tasksActivity.status);
  const runActive = !!runActivity && isLoopActivityActive(runActivity.status);

  useEffect(() => {
    if (!canBrowseFiles && activeTab === "files") {
      setActiveTab("tasks");
    }
  }, [activeTab, canBrowseFiles, setActiveTab]);
  const project = ctx?.project;
  const handleArchive = ctx?.handleArchive;
  const tabs = useMemo<TabItem[]>(
    () => [
      { id: "terminal", icon: <SquareTerminal size={16} />, title: "Terminal" },
      { id: "browser", icon: <Globe size={16} />, title: "Browser" },
      { id: "specs", icon: <File size={16} />, title: "Specs" },
      {
        id: "tasks",
        icon: tasksActive ? (
          <LoopProgress
            source={{ activity: tasksActivity }}
            size={16}
            className={styles.automationSpinner}
          />
        ) : (
          <Check size={16} />
        ),
        title: "Tasks",
      },
      {
        id: "run",
        icon: runActive ? (
          <LoopProgress
            source={{ activity: runActivity }}
            size={16}
            className={styles.automationSpinner}
          />
        ) : (
          <Play size={16} />
        ),
        title: "Run",
      },
      { id: "stats", icon: <BarChart3 size={16} />, title: "Stats" },
      { id: "log", icon: <ScrollText size={16} />, title: "Log" },
      { id: "sessions", icon: <Monitor size={16} />, title: "Sessions" },
      { id: "files", icon: <FolderClosed size={16} />, title: "Files" },
      { id: "new-terminal", icon: <Plus size={16} />, title: "New terminal", kind: "action" },
      { id: "new-browser", icon: <Plus size={16} />, title: "New browser", kind: "action" },
    ],
    [tasksActive, runActive, tasksActivity, runActivity],
  );
  const visibleTabs = canBrowseFiles ? tabs : tabs.filter((tab) => tab.id !== "files");

  const actions = useMemo<MenuItem[]>(() => {
    if (!project) return [];
    return [
      ...(project.current_status !== "archived"
        ? [{ id: "archive", label: "Archive", icon: <Archive size={14} /> }]
        : []),
      { id: "info", label: "Project Info", icon: <Info size={14} /> },
    ];
  }, [project]);

  if (showInfo) return null;

  const handleAction = (id: string) => {
    if (id === "archive") handleArchive?.();
    if (id === "info") toggleInfo("Project Info", null);
  };

  const handleInlineAction = (id: string) => {
    if (id === "new-terminal") {
      addTerminal();
      setActiveTab("terminal");
      return;
    }
    if (id === "new-browser") {
      addBrowserInstance();
      setActiveTab("browser");
    }
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
