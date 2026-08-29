import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { ModalConfirm, type MenuItem } from "@cypher-asi/zui";
import {
  Archive,
  BrainCircuit,
  Info,
  File,
  ClipboardClock,
  ChartNoAxesColumnIncreasing,
  MessageSquare,
  FolderClosed,
  GitBranch,
  SquareTerminal,
  MonitorPlay,
} from "lucide-react";
import { useSidekickStore, type SidekickTab } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import {
  canStartWorkspaceAutomation,
  resolveWorkspaceAccess,
} from "../../shared/lib/workspace-access";
import { SidekickTabBar, type TabItem } from "../SidekickTabBar";
import { CheckLoopGlyph } from "../CheckLoopGlyph";
import { PlayLoopGlyph } from "../PlayLoopGlyph";
import { LoopEngineeringPanel } from "../AutomationBar/LoopEngineeringPanel";
import { useAutomationStatus } from "../AutomationBar/useAutomationStatus";
import {
  selectAgentInstanceActivity,
  selectProjectActivity,
  useLoopActivityStore,
} from "../../stores/loop-activity-store";
import { isLoopActivityActive } from "../../shared/types/aura-events";
import type { LoopEngineeringContract } from "../../shared/api/loop";
import type { ProjectId } from "../../shared/types";
import styles from "../Sidekick/Sidekick.module.css";

export function SidekickTaskbar() {
  const [loopEngineeringOpen, setLoopEngineeringOpen] = useState(false);
  const [loopPanelStyle, setLoopPanelStyle] =
    useState<CSSProperties | null>(null);
  const taskbarRef = useRef<HTMLDivElement>(null);
  const { activeTab, setActiveTab, showInfo, toggleInfo } = useSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      showInfo: s.showInfo,
      toggleInfo: s.toggleInfo,
    })),
  );
  const ctx = useProjectActions();
  const { features, hostedLocalHarness } = useAuraCapabilities();
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const terminalTarget = useTerminalTarget({ projectId, agentInstanceId });
  const workspaceAccess = resolveWorkspaceAccess({
    workspacePath: terminalTarget.workspacePath,
    remoteWorkspacePath: terminalTarget.remoteWorkspacePath,
    remoteAgentId: terminalTarget.remoteAgentId,
    linkedWorkspace: features.linkedWorkspace,
  });
  const canUseWorkspace = workspaceAccess.canUseWorkspace;
  const canUseHostedFiles = Boolean(
    hostedLocalHarness && projectId && terminalTarget.localAgentInstanceId,
  );
  const canUseFiles = canUseWorkspace || canUseHostedFiles;
  const canUseSourceControl =
    workspaceAccess.canUseWorkspace && workspaceAccess.kind === "local";
  const startAgentInstanceId =
    workspaceAccess.kind === "remote"
      ? terminalTarget.remoteAgentInstanceId
      : undefined;
  const automationStartAvailable =
    canUseWorkspace &&
    canStartWorkspaceAutomation(workspaceAccess, startAgentInstanceId);
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
  const tasksActive =
    !!tasksActivity && isLoopActivityActive(tasksActivity.status);
  const runActive = !!runActivity && isLoopActivityActive(runActivity.status);

  useEffect(() => {
    if (
      (!canUseFiles && activeTab === "files") ||
      (!canUseWorkspace && activeTab === "terminal") ||
      (!canUseSourceControl && activeTab === "source-control")
    ) {
      setActiveTab("sessions");
    }
  }, [activeTab, canUseFiles, canUseSourceControl, canUseWorkspace, setActiveTab]);
  useEffect(() => {
    if (automationStartAvailable || !loopEngineeringOpen) return;
    setLoopEngineeringOpen(false);
    setLoopPanelStyle(null);
  }, [automationStartAvailable, loopEngineeringOpen]);
  const project = ctx?.project;
  const handleArchive = ctx?.handleArchive;
  const loopProjectId = project?.project_id ?? projectId ?? null;
  const tabs = useMemo<TabItem[]>(() => {
    const items: TabItem[] = [
      {
        id: "sessions",
        icon: <MessageSquare size={16} />,
        title: "Chats",
      },
      ...(canUseWorkspace
        ? [
            {
              id: "terminal",
              icon: <SquareTerminal size={16} />,
              title: "Terminal",
            },
          ]
        : []),
      ...(canUseSourceControl
        ? [
            {
              id: "source-control",
              icon: <GitBranch size={16} />,
              title: "Source Control",
            },
          ]
        : []),
      { id: "browser", icon: <MonitorPlay size={16} />, title: "Preview" },
      ...(canUseFiles
        ? [{ id: "files", icon: <FolderClosed size={16} />, title: "Files" }]
        : []),
      { id: "specs", icon: <File size={16} />, title: "Plans" },
      {
        id: "run",
        // `PlayLoopGlyph` keeps the Play affordance recognisable AND
        // shows loop activity in a single SVG, so the Play glyph and
        // the spinning ring are guaranteed concentric. The earlier
        // "icon + absolutely-positioned ring overlay" rendered as
        // two side-by-side glyphs inside the tab button's icon slot
        // — the overlay wasn't anchoring to its wrap span and users
        // couldn't tell the Run tab was still the Run tab.
        icon: <PlayLoopGlyph active={runActive} size={16} />,
        title: "Run",
      },
      ...(loopProjectId && automationStartAvailable
        ? [
            {
              id: "loop-engineering",
              kind: "action" as const,
              icon: <BrainCircuit size={16} />,
              title: "Loop Engineering",
            },
          ]
        : []),
      {
        id: "tasks",
        // `CheckLoopGlyph` mirrors `PlayLoopGlyph`: the Check
        // affordance stays visible at all times and the rotating
        // accent ring is drawn in the same SVG when a task loop is
        // active. The earlier behaviour swapped the entire icon out
        // for a bare `LoopProgress` spinner, which made the tab hard
        // to recognise while busy and broke visual parity with the
        // adjacent Run tab.
        icon: <CheckLoopGlyph active={tasksActive} size={16} />,
        title: "Tasks",
      },
      // Stats is a primary navigation destination (asserted by the
      // core smoke + workflow evals), so it must stay in the visible
      // tab row. The sidekick lane only fits ~7 icon tabs at its
      // default 320px width. Files is intentionally pinned beside Preview;
      // Logs remains the secondary destination that can enter overflow.
      {
        id: "stats",
        icon: <ChartNoAxesColumnIncreasing size={16} />,
        title: "Stats",
      },
      { id: "log", icon: <ClipboardClock size={16} />, title: "Logs" },
    ];
    return items;
  }, [
    tasksActive,
    runActive,
    loopProjectId,
    canUseWorkspace,
    canUseFiles,
    canUseSourceControl,
    automationStartAvailable,
  ]);
  const visibleTabs = tabs;

  const actions = useMemo<MenuItem[]>(() => {
    if (!project) return [];
    return [
      ...(project.current_status !== "archived"
        ? [{ id: "archive", label: "Archive", icon: <Archive size={14} /> }]
        : []),
      { id: "info", label: "Project Info", icon: <Info size={14} /> },
    ];
  }, [project]);

  useLayoutEffect(() => {
    if (!loopEngineeringOpen) return;

    const updatePanelPosition = () => {
      const rect = taskbarRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth || 1280;
      setLoopPanelStyle({
        top: rect.bottom + 4,
        right: Math.max(12, viewportWidth - rect.right),
        width: Math.min(560, viewportWidth - 24),
      });
    };

    updatePanelPosition();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && taskbarRef.current
        ? new ResizeObserver(updatePanelPosition)
        : null;
    if (taskbarRef.current) resizeObserver?.observe(taskbarRef.current);
    window.addEventListener("resize", updatePanelPosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePanelPosition);
    };
  }, [loopEngineeringOpen]);

  if (showInfo) return null;

  const handleAction = (id: string) => {
    if (id === "archive") handleArchive?.();
    if (id === "info") toggleInfo("Project Info", null);
  };

  const handleInlineAction = (id: string) => {
    if (id === "loop-engineering") {
      if (loopEngineeringOpen) {
        setLoopEngineeringOpen(false);
        setLoopPanelStyle(null);
      } else {
        setLoopEngineeringOpen(true);
      }
    }
  };

  return (
    <div ref={taskbarRef} className={styles.sidekickTaskbarWithPanel}>
      <SidekickTabBar
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as SidekickTab)}
        onInlineAction={handleInlineAction}
        actions={actions}
        onAction={handleAction}
        alwaysShowMore={!!project}
      />
      {loopEngineeringOpen &&
      loopProjectId &&
      loopPanelStyle &&
      typeof document !== "undefined"
        ? createPortal(
            <SidekickLoopEngineeringPanel
              projectId={loopProjectId}
              startAgentInstanceId={startAgentInstanceId}
              allowDetachedReattach={automationStartAvailable}
              style={loopPanelStyle}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function SidekickLoopEngineeringPanel({
  projectId,
  startAgentInstanceId,
  allowDetachedReattach,
  style,
}: {
  projectId: ProjectId;
  startAgentInstanceId?: string;
  allowDetachedReattach: boolean;
  style: CSSProperties;
}) {
  const {
    canStartLoopEngineering,
    handleStartLoopEngineering,
    startError,
    clearStartError,
  } = useAutomationStatus(projectId, startAgentInstanceId, {
    allowDetachedReattach,
    detachedReattachAgentInstanceId: startAgentInstanceId,
  });

  const handleStart = useCallback(
    async (contract: LoopEngineeringContract) => {
      await handleStartLoopEngineering(contract);
    },
    [handleStartLoopEngineering],
  );

  return (
    <>
      <div className={styles.sidekickTaskbarPanel} style={style}>
        <LoopEngineeringPanel
          projectId={projectId}
          canStart={canStartLoopEngineering}
          onStart={handleStart}
        />
      </div>

      {startError ? (
        <ModalConfirm
          isOpen
          onClose={clearStartError}
          onConfirm={clearStartError}
          title="Loop Engineering start failed"
          message={startError.message}
          confirmLabel="Dismiss"
          cancelLabel="Close"
        />
      ) : null}
    </>
  );
}
