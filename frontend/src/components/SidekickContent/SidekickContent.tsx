import { useState, useEffect } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { PanelSearch } from "../PanelSearch";
import { StatusBadge } from "../StatusBadge";
import { useSidekick } from "../../stores/sidekick-store";
import { useProjectContext } from "../../stores/project-action-store";
import { SpecList } from "../../views/SpecList";
import { TaskList } from "../../views/TaskList";
import { StatsDashboard } from "../../views/StatsDashboard";
import { SessionList } from "../../views/SessionList";
import { SidekickLog } from "../../views/SidekickLog";
import { FileExplorer } from "../FileExplorer";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { hasLinkedWorkspace, getLinkedWorkspaceRoot } from "../../utils/projectWorkspace";
import styles from "../Sidekick/Sidekick.module.css";

function InfoPanel({ project, onClose }: { project: import("../types").Project; onClose: () => void }) {
  const workspaceLabel = project.workspace_source === "imported"
    ? project.workspace_display_path ?? "Imported workspace snapshot"
    : project.linked_folder_path || "—";

  return (
    <div className={styles.infoArea}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onClose} />
        <Text size="sm" style={{ fontWeight: 600 }}>Project Info</Text>
      </div>
      <div className={styles.infoGrid}>
        <Text variant="muted" size="sm" as="span">Status</Text>
        <span><StatusBadge status={project.current_status} /></span>
        <Text variant="muted" size="sm" as="span">Workspace</Text>
        <Text size="sm" as="span">{workspaceLabel}</Text>
        <Text variant="muted" size="sm" as="span">Created</Text>
        <Text size="sm" as="span">{new Date(project.created_at).toLocaleString()}</Text>
      </div>
    </div>
  );
}

const SEARCH_PLACEHOLDERS: Record<string, string> = {};

export function SidekickContent() {
  const { activeTab, showInfo, toggleInfo } = useSidekick();
  const ctx = useProjectContext();
  const [searchQuery, setSearchQuery] = useState("");
  const { features } = useAuraCapabilities();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSearchQuery(""));
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab]);

  if (!ctx) {
    return <EmptyState>Select a project to get started</EmptyState>;
  }

  const { project } = ctx;
  const linkedWorkspaceRoot = getLinkedWorkspaceRoot(project);
  const canBrowseFiles = features.linkedWorkspace && Boolean(linkedWorkspaceRoot);

  if (showInfo) {
    return <InfoPanel project={project} onClose={() => toggleInfo("", null)} />;
  }

  const searchable = activeTab !== "stats";

  const tabContent: Record<string, React.ReactNode> = {
    specs: <SpecList searchQuery={searchQuery} />,
    tasks: <TaskList searchQuery={searchQuery} />,
    stats: <StatsDashboard />,
    sessions: <SessionList searchQuery={searchQuery} />,
    files: canBrowseFiles
      ? <FileExplorer rootPath={linkedWorkspaceRoot ?? undefined} searchQuery={searchQuery} />
      : (
        <div className={styles.emptyState}>
          <Text variant="muted" size="sm">
            {features.linkedWorkspace
              ? "Imported workspaces do not expose live host files."
              : "File browsing stays in the desktop app for now."}
          </Text>
        </div>
      ),
  };

  return (
    <div className={styles.sidekickBody}>
      {searchable && (
        <PanelSearch
          placeholder={SEARCH_PLACEHOLDERS[activeTab] ?? ""}
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
