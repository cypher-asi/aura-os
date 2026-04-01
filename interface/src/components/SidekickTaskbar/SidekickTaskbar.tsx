import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { Button, Menu } from "@cypher-asi/zui";
import { Archive, Info, Ellipsis, File, Check, Logs, ChartNoAxesColumnIncreasing, MonitorCog, FolderClosed } from "lucide-react";
import { useSidekick, type SidekickTab } from "../../stores/sidekick-store";
import { useProjectContext } from "../../stores/project-action-store";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import styles from "../Sidekick/Sidekick.module.css";

const TAB_ICONS: { id: SidekickTab; icon: React.ReactNode; title: string }[] = [
  { id: "specs", icon: <File size={16} />, title: "Specs" },
  { id: "tasks", icon: <Check size={16} />, title: "Tasks" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
  { id: "log", icon: <Logs size={16} />, title: "Log" },
  { id: "sessions", icon: <MonitorCog size={16} />, title: "Sessions" },
  { id: "files", icon: <FolderClosed size={16} />, title: "Files" },
];

export function SidekickTaskbar() {
  const { activeTab, setActiveTab, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { features } = useAuraCapabilities();
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

  useLayoutEffect(() => {
    if (moreOpen && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.right - 180 });
    } else {
      setMenuRect(null);
    }
  }, [moreOpen]);

  useClickOutside([moreBtnRef, moreMenuRef], () => setMoreOpen(false), moreOpen);

  if (showInfo) return null;

  const project = ctx?.project;
  const handleArchive = ctx?.handleArchive;
  const visibleTabs = canBrowseFiles ? TAB_ICONS : TAB_ICONS.filter((tab) => tab.id !== "files");

  return (
    <div className={styles.sidekickTaskbar}>
      <div className={styles.sidekickTabBar}>
        {visibleTabs.map(({ id, icon, title }) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            iconOnly
            icon={icon}
            title={title}
            aria-label={title}
            onClick={() => setActiveTab(id)}
            aria-pressed={activeTab === id}
            selected={activeTab === id}
          />
        ))}
      </div>
      {project && (
        <div ref={moreBtnRef} className={styles.moreButtonWrap}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Ellipsis size={16} />}
            onClick={() => setMoreOpen((v) => !v)}
            title="More actions"
            aria-label="More actions"
          />
          {moreOpen &&
            menuRect &&
            createPortal(
              <div
                ref={moreMenuRef}
                className={styles.moreMenu}
                style={{
                  position: "fixed",
                  top: menuRect.top,
                  left: menuRect.left,
                  zIndex: 100,
                }}
              >
                <Menu
                  items={[
                    ...(project.current_status !== "archived"
                      ? [{ id: "archive", label: "Archive", icon: <Archive size={14} /> }]
                      : []),
                    { id: "info", label: "Project Info", icon: <Info size={14} /> },
                  ]}
                  onChange={(id) => {
                    setMoreOpen(false);
                    if (id === "archive") handleArchive?.();
                    if (id === "info") toggleInfo("Project Info", null);
                  }}
                  background="solid"
                  border="solid"
                  rounded="md"
                  width={180}
                  isOpen
                />
              </div>,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}
