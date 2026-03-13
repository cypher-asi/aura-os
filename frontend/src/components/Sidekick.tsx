import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useState, useRef, useEffect } from "react";
import { Sidebar, Tabs, Button, Text, Menu } from "@cypher-asi/zui";
import { Play, Archive, Info, ArrowLeft, Ellipsis } from "lucide-react";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { StatusBadge } from "./StatusBadge";
import { SpecList } from "../views/SpecList";
import { TaskList } from "../views/TaskList";
import { ProgressDashboard } from "../views/ProgressDashboard";
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
        <Text variant="muted" size="sm" as="span">Requirements</Text>
        <Text size="sm" as="span">{project.requirements_doc_path || "—"}</Text>
        <Text variant="muted" size="sm" as="span">Created</Text>
        <Text size="sm" as="span">{new Date(project.created_at).toLocaleString()}</Text>
      </div>
    </div>
  );
}

function SpecViewer({ spec, onBack }: { spec: import("../types").Spec; onBack: () => void }) {
  return (
    <div className={styles.viewerArea}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onBack} />
        <Text size="sm" style={{ fontWeight: 600 }}>{spec.title}</Text>
      </div>
      <div className={styles.markdown}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {spec.markdown_contents}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export function Sidekick() {
  const { activeTab, setActiveTab, selectedSpec, clearSpec, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreBtnRef.current && !moreBtnRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  if (!ctx) {
    return (
      <Sidebar
        className={styles.sidekickPanel}
        resizable
        resizePosition="left"
        defaultWidth={420}
        minWidth={300}
        maxWidth={700}
        storageKey="aura-sidekick"
      >
        <div className={styles.emptyState}>
          <Text variant="muted" size="sm">Select a project to get started</Text>
        </div>
      </Sidebar>
    );
  }

  const { project, handleArchive, navigateToExecution } = ctx;

  if (showInfo) {
    return (
      <Sidebar
        className={styles.sidekickPanel}
        resizable
        resizePosition="left"
        defaultWidth={420}
        minWidth={300}
        maxWidth={700}
        storageKey="aura-sidekick"
      >
        <InfoPanel project={project} onClose={() => toggleInfo("", null)} />
      </Sidebar>
    );
  }

  if (selectedSpec) {
    return (
      <Sidebar
        className={styles.sidekickPanel}
        resizable
        resizePosition="left"
        defaultWidth={420}
        minWidth={300}
        maxWidth={700}
        storageKey="aura-sidekick"
      >
        <SpecViewer spec={selectedSpec} onBack={clearSpec} />
      </Sidebar>
    );
  }

  const tabContent = {
    specs: <SpecList />,
    tasks: <TaskList />,
    progress: <ProgressDashboard />,
  };

  return (
    <Sidebar
      className={styles.sidekickPanel}
      resizable
      resizePosition="left"
      defaultWidth={420}
      minWidth={300}
      maxWidth={700}
      storageKey="aura-sidekick"
      header={
        <div className={styles.panelHeader}>
          <Tabs
            className={styles.tabsNoBorder}
            tabs={[
              { id: "specs", label: "Specs" },
              { id: "tasks", label: "Tasks" },
              { id: "progress", label: "Progress" },
            ]}
            value={activeTab}
            onChange={(id) => setActiveTab(id as "specs" | "tasks" | "progress")}
          />
          <div className={styles.actions}>
            <Button variant="filled" size="sm" iconOnly icon={<Play size={16} />} onClick={navigateToExecution} title="Start Dev Loop" />
            <div ref={moreBtnRef} className={styles.moreButtonWrap}>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={<Ellipsis size={16} />}
                onClick={() => setMoreOpen((v) => !v)}
                title="More actions"
              />
              {moreOpen && (
                <div className={styles.moreMenu}>
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
                </div>
              )}
            </div>
          </div>
        </div>
      }
    >
      <div className={styles.sidekickBody}>
        {tabContent[activeTab]}
      </div>
    </Sidebar>
  );
}
