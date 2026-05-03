import { lazy, Suspense, useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@cypher-asi/zui";
import { RefreshCw } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { PanelSearch } from "../PanelSearch";
import { PreviewContent, PreviewHeader } from "../Preview";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { SpecList } from "../../views/SpecList";
import { TaskList } from "../../views/TaskList";
import { StatsDashboard } from "../../views/StatsDashboard";
import { SessionList } from "../../views/SessionList";
import { SidekickLog } from "../../views/SidekickLog";
import { FileExplorer } from "../FileExplorer";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { InfoPanel } from "./InfoPanel";
import styles from "../Sidekick/Sidekick.module.css";

const BrowserPanel = lazy(() =>
  import("../../apps/browser/components/BrowserPanel").then((m) => ({ default: m.BrowserPanel })),
);
const RunSidekickPane = lazy(() =>
  import("../TaskOutputPanel").then((m) => ({ default: m.RunSidekickPane })),
);
const TerminalSidekickPane = lazy(() =>
  import("../TaskOutputPanel").then((m) => ({ default: m.TerminalSidekickPane })),
);
import overlayStyles from "../PreviewOverlay/PreviewOverlay.module.css";

const SEARCH_PLACEHOLDERS: Record<string, string> = {
  specs: "Search",
  tasks: "Search",
  sessions: "Search",
  files: "Search",
  log: "Search",
};

export function SidekickContent() {
  const { activeTab, showInfo, toggleInfo, previewItem } = useSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      showInfo: s.showInfo,
      toggleInfo: s.toggleInfo,
      previewItem: s.previewItem,
    })),
  );
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const [searchQuery, setSearchQuery] = useState("");
  const { features } = useAuraCapabilities();
  const { projectId: routeProjectId, agentInstanceId } = useParams<{
    projectId: string;
    agentInstanceId: string;
  }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath } =
    useTerminalTarget({ projectId: routeProjectId, agentInstanceId });
  const navigate = useNavigate();
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const tabContentRef = useRef<HTMLDivElement>(null);

  const handleRemoteFileSelect = useCallback(
    (filePath: string) => {
      if (remoteAgentId) {
        navigate(
          `/ide?file=${encodeURIComponent(filePath)}&remoteAgentId=${encodeURIComponent(remoteAgentId)}`,
        );
      }
    },
    [remoteAgentId, navigate],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSearchQuery(""));
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab]);

  if (!ctx) {
    if (routeProjectId) return null;
    return <EmptyState>Select a project to get started</EmptyState>;
  }

  const { project } = ctx;
  const remoteRoot = remoteWorkspacePath ?? null;
  const localRoot = !remoteAgentId ? (workspacePath ?? null) : null;
  const workspaceRoot = remoteAgentId ? remoteRoot : localRoot;
  const canBrowseLocal = features.linkedWorkspace && Boolean(localRoot);
  const canBrowseRemote = Boolean(remoteAgentId) && Boolean(remoteRoot);
  const canBrowseFiles = canBrowseLocal || canBrowseRemote;
  const filesEmptyMessage = remoteAgentId
    ? "The attached remote agent has not reported a live workspace yet."
    : features.linkedWorkspace
      ? "This project does not currently expose a live local agent workspace."
      : "File browsing stays in the desktop app for now.";

  if (showInfo) {
    return (
      <InfoPanel
        project={project}
        workspacePath={workspacePath}
        remoteAgentId={remoteAgentId}
        onClose={() => toggleInfo("", null)}
      />
    );
  }

  const searchable =
    activeTab !== "stats" &&
    activeTab !== "run" &&
    activeTab !== "terminal" &&
    activeTab !== "browser";

  const filesContent = canBrowseFiles ? (
    <FileExplorer
      rootPath={workspaceRoot ?? undefined}
      searchQuery={searchQuery}
      remoteAgentId={remoteAgentId}
      onFileSelect={remoteAgentId ? handleRemoteFileSelect : undefined}
      refreshTrigger={fileRefreshKey}
    />
  ) : (
    <EmptyState>{filesEmptyMessage}</EmptyState>
  );
  const sidekickPaneFallback = (
    <div style={{ padding: 16, color: "var(--color-text-muted)", fontSize: 12 }}>
      Loading...
    </div>
  );
  const activeContent =
    activeTab === "terminal" ? (
      <Suspense fallback={sidekickPaneFallback}>
        <TerminalSidekickPane />
      </Suspense>
    ) : activeTab === "browser" ? (
      <Suspense fallback={sidekickPaneFallback}>
        <BrowserPanel projectId={projectId} />
      </Suspense>
    ) : activeTab === "run" ? (
      <Suspense fallback={sidekickPaneFallback}>
        <RunSidekickPane />
      </Suspense>
    ) : activeTab === "specs" ? (
      <SpecList searchQuery={searchQuery} />
    ) : activeTab === "tasks" ? (
      <TaskList searchQuery={searchQuery} />
    ) : activeTab === "stats" ? (
      <StatsDashboard />
    ) : activeTab === "sessions" ? (
      <SessionList searchQuery={searchQuery} />
    ) : activeTab === "files" ? (
      filesContent
    ) : activeTab === "log" ? (
      <SidekickLog searchQuery={searchQuery} />
    ) : null;

  return (
    <div className={styles.sidekickBody}>
      {searchable && (
        <PanelSearch
          placeholder={SEARCH_PLACEHOLDERS[activeTab] ?? ""}
          value={searchQuery}
          onChange={setSearchQuery}
          action={
            activeTab === "files" ? (
              <button
                type="button"
                onClick={() => setFileRefreshKey((k) => k + 1)}
                title="Refresh file tree"
                aria-label="Refresh file tree"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                }}
              >
                <RefreshCw size={14} />
              </button>
            ) : undefined
          }
        />
      )}
      <div className={styles.sidekickContent}>
        {(activeTab === "run" || activeTab === "terminal" || activeTab === "browser") &&
          activeContent}
        {activeTab !== "log" &&
          activeTab !== "run" &&
          activeTab !== "terminal" &&
          activeTab !== "browser" && (
          <div className={styles.tabContentShell}>
            <div ref={tabContentRef} className={styles.tabContent}>
              {activeContent}
            </div>
            <OverlayScrollbar scrollRef={tabContentRef} />
          </div>
        )}
        {activeTab === "log" && (
          <div className={styles.tabContentShell}>
            <div className={styles.tabContent}>
              {activeContent}
            </div>
          </div>
        )}
      </div>
      {previewItem && <LaneOverlay />}
    </div>
  );
}

function LaneOverlay() {
  const markerRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const closePreview = useSidekickStore((s) => s.closePreview);

  useLayoutEffect(() => {
    if (markerRef.current) {
      const lane = markerRef.current.closest(
        "[data-lane]",
      ) as HTMLElement | null;
      if (lane) setPortalTarget(lane);
    }
  }, []);

  // Close the task/spec/session/log preview on Escape. Defer to any modal
  // dialog layered on top so ESC dismisses the topmost surface first.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      const hasModalOnTop = document.querySelector(
        '[role="dialog"][aria-modal="true"]',
      );
      if (hasModalOnTop) return;
      closePreview();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closePreview]);

  const content = (
    <div className={cn(overlayStyles.overlay, overlayStyles.fullLane)}>
      <PreviewHeader />
      <PreviewContent />
    </div>
  );

  if (portalTarget) {
    return (
      <>
        <div ref={markerRef} style={{ display: "none" }} />
        {createPortal(content, portalTarget)}
      </>
    );
  }

  return (
    <>
      <div ref={markerRef} style={{ display: "none" }} />
      {content}
    </>
  );
}
