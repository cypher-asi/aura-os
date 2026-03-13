import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Sidebar, Tabs, Button, Text } from "@cypher-asi/zui";
import { Play, Archive, FileText, Info, ArrowLeft } from "lucide-react";
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

  const { project, genLoading, handleGenerateSpecs, handleStopGeneration, handleArchive, navigateToExecution } = ctx;

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
            tabs={[
              { id: "specs", label: "Specs" },
              { id: "tasks", label: "Tasks" },
              { id: "progress", label: "Progress" },
            ]}
            value={activeTab}
            onChange={(id) => setActiveTab(id as "specs" | "tasks" | "progress")}
          />
          <div className={styles.actions}>
            {genLoading ? (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={
                  <span className={styles.stopIcon}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <circle className={styles.stopRing} cx="14" cy="14" r="12" stroke="var(--color-danger, #ef4444)" strokeWidth="2" strokeDasharray="22 54" strokeLinecap="round" />
                      <circle cx="14" cy="14" r="8.5" stroke="var(--color-danger, #ef4444)" strokeWidth="1" opacity="0.25" fill="none" />
                      <rect x="9.5" y="9.5" width="9" height="9" rx="0.75" fill="var(--color-danger, #ef4444)" />
                    </svg>
                  </span>
                }
                onClick={handleStopGeneration}
                title="Stop Generation"
              />
            ) : (
              <Button variant="ghost" size="sm" iconOnly icon={<FileText size={16} />} onClick={handleGenerateSpecs} title="Generate Specs" />
            )}
            <Button variant="filled" size="sm" iconOnly icon={<Play size={16} />} onClick={navigateToExecution} title="Start Dev Loop" />
            {project.current_status !== "archived" && (
              <Button variant="danger" size="sm" iconOnly icon={<Archive size={16} />} onClick={handleArchive} title="Archive" />
            )}
            <Button variant="ghost" size="sm" iconOnly icon={<Info size={16} />} onClick={() => toggleInfo("Project Info", null)} title="Project Info" />
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
