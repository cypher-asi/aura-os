import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, Text, Menu } from "@cypher-asi/zui";
import { Archive, Info, ArrowLeft, Ellipsis, FileText, Check, Logs, BarChart3, MonitorCog, Code } from "lucide-react";
import { PanelSearch } from "./PanelSearch";
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
import { FileExplorer } from "./FileExplorer";
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

const TAB_ICONS: { id: SidekickTab; icon: React.ReactNode; title: string }[] = [
  { id: "specs", icon: <FileText size={16} />, title: "Specs" },
  { id: "tasks", icon: <Check size={16} />, title: "Tasks" },
  { id: "log", icon: <Logs size={16} />, title: "Log" },
  { id: "progress", icon: <BarChart3 size={16} />, title: "KPIs" },
  { id: "sessions", icon: <MonitorCog size={16} />, title: "Sessions" },
  { id: "files", icon: <Code size={16} />, title: "Files" },
];

export function SidekickHeader() {
  const ctx = useProjectContext();
  const { showInfo } = useSidekick();
  if (!ctx || showInfo) return null;
  return <AutomationBar projectId={ctx.project.project_id} />;
}

export function SidekickTaskbar() {
  const { activeTab, setActiveTab, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (moreOpen && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.top - 4, left: rect.right - 180 });
    } else {
      setMenuRect(null);
    }
  }, [moreOpen]);

  useClickOutside([moreBtnRef, moreMenuRef], () => setMoreOpen(false), moreOpen);

  if (!ctx || showInfo) return null;

  const { project, handleArchive } = ctx;

  return (
    <div className={styles.sidekickTaskbar}>
      <div className={styles.sidekickTabBar}>
        {TAB_ICONS.map(({ id, icon, title }) => (
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
                transform: "translateY(-100%)",
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
  );
}

const SEARCH_PLACEHOLDERS: Record<string, string> = {
  specs: "Search specs...",
  tasks: "Search tasks...",
  log: "Search logs...",
  sessions: "Search sessions...",
  files: "Search files...",
};

export function SidekickContent() {
  const { activeTab, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setSearchQuery("");
  }, [activeTab]);

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

  const searchable = activeTab !== "progress";

  const tabContent: Record<string, React.ReactNode> = {
    specs: <SpecList searchQuery={searchQuery} />,
    tasks: <TaskList searchQuery={searchQuery} />,
    progress: <ProgressDashboard />,
    sessions: <SessionList searchQuery={searchQuery} />,
    files: <FileExplorer rootPath={project.linked_folder_path} searchQuery={searchQuery} />,
  };

  return (
    <div className={styles.sidekickBody}>
      {searchable && (
        <PanelSearch
          placeholder={SEARCH_PLACEHOLDERS[activeTab] ?? "Search..."}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      )}
      <div className={styles.sidekickContent}>
        {activeTab !== "log" && (
          <div className={styles.tabContent}>
            {tabContent[activeTab]}
          </div>
        )}
        <div className={styles.tabContent} style={activeTab === "log" ? undefined : { display: "none" }}>
          <SidekickLog searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
}
