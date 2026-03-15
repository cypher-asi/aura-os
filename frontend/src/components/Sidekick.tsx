import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Tabs, Button, Text, Menu } from "@cypher-asi/zui";
import { Archive, Info, ArrowLeft, Ellipsis } from "lucide-react";
import { AutomationBar } from "./AutomationBar";
import { useSidekick, type SidekickTab } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useClickOutside } from "../hooks/use-click-outside";
import { StatusBadge } from "./StatusBadge";
import { SpecList } from "../views/SpecList";
import { TaskList } from "../views/TaskList";
import { ProgressDashboard } from "../views/ProgressDashboard";
import { SessionList } from "../views/SessionList";
import { SidekickLog } from "../views/SidekickLog";
import styles from "./Sidekick.module.css";

function InfoPanel({ project, onClose }: { project: import("../types").Project; onClose: () => void }) {
  return (
    <div className={styles.infoArea}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onClose} />
        <Text size="sm" style={{ fontWeight: 600 }}>Project Info</Text>
      </div>
      <div className={styles.infoGrid}>
        <Text variant="muted" size="sm" as="span">Status</Text>
        <span><StatusBadge status={project.current_status} /></span>
        <Text variant="muted" size="sm" as="span">Folder</Text>
        <Text size="sm" as="span">{project.linked_folder_path || "—"}</Text>
        <Text variant="muted" size="sm" as="span">Created</Text>
        <Text size="sm" as="span">{new Date(project.created_at).toLocaleString()}</Text>
      </div>
    </div>
  );
}

export function SidekickHeader() {
  const { activeTab, setActiveTab, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (moreOpen && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.right - 180 });
    } else {
      setMenuRect(null);
    }
  }, [moreOpen]);

  useClickOutside([moreBtnRef, moreMenuRef], () => setMoreOpen(false), moreOpen);

  if (!ctx || showInfo) return null;

  const { project, handleArchive } = ctx;

  return (
    <>
      <AutomationBar projectId={project.project_id} />
      <div className={styles.panelHeader}>
        <Tabs
          tabs={[
            { id: "specs", label: "Specs" },
            { id: "tasks", label: "Tasks" },
            { id: "log", label: "Log" },
            { id: "progress", label: "KPIs" },
            { id: "sessions", label: "Sessions" },
          ]}
          value={activeTab}
          onChange={(id) => setActiveTab(id as SidekickTab)}
          className={styles.tabsFullBleed}
          tabClassName={styles.sidekickTab}
        />
        <div className={styles.actions}>
          <div ref={moreBtnRef} className={styles.moreButtonWrap}>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Ellipsis size={16} />}
              onClick={() => setMoreOpen((v) => !v)}
              title="More actions"
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
                      if (id === "archive") handleArchive();
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
        </div>
      </div>
    </>
  );
}

export function SidekickContent() {
  const { activeTab, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();

  if (!ctx) {
    return (
      <div className={styles.emptyState}>
        <Text variant="muted" size="sm">Select a project to get started</Text>
      </div>
    );
  }

  const { project } = ctx;

  if (showInfo) {
    return <InfoPanel project={project} onClose={() => toggleInfo("", null)} />;
  }

  const tabContent: Record<string, React.ReactNode> = {
    specs: <SpecList />,
    tasks: <TaskList />,
    progress: <ProgressDashboard />,
    sessions: <SessionList />,
  };

  return (
    <div className={styles.sidekickBody}>
      <div className={styles.sidekickContent}>
        {activeTab !== "log" && (
          <div className={styles.tabContent}>
            {tabContent[activeTab]}
          </div>
        )}
        <div className={styles.tabContent} style={activeTab === "log" ? undefined : { display: "none" }}>
          <SidekickLog />
        </div>
      </div>
    </div>
  );
}
