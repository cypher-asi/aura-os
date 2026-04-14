import { useMemo } from "react";
import { PageEmptyState } from "@cypher-asi/zui";
import { FolderGit2 } from "lucide-react";
import { useProjectListData } from "../ProjectList/useProjectListData";
import { ProjectListModals } from "../ProjectList/ProjectListModals";
import { ExplorerContextMenu } from "../ProjectList/ExplorerContextMenu";
import {
  useProjectsExplorerModel,
} from "../ProjectList/project-list-projects-explorer";
import { LeftMenuTree, buildLeftMenuEntries } from "../../features/left-menu";
import styles from "../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css";

const explorerNodeStyles = {
  projectSuffix: styles.projectSuffix,
  newChatWrap: styles.newChatWrap,
  agentTrailing: styles.agentTrailing,
  agentStatusWrap: styles.agentStatusWrap,
  agentActionWrap: styles.agentActionWrap,
  agentActionButton: styles.agentActionButton,
  sessionIndicator: styles.sessionIndicator,
  automationSpinner: styles.automationSpinner,
  streamingDot: styles.streamingDot,
};

export function ProjectsNav() {
  const data = useProjectListData("projects");
  const explorer = useProjectsExplorerModel(data, explorerNodeStyles);
  const expandedIds = useMemo(
    () => new Set(explorer.expandedIds),
    [explorer.expandedIds],
  );
  const entries = useMemo(
    () =>
      buildLeftMenuEntries(explorer.filteredExplorerData, {
        expandedIds,
        selectedNodeId: explorer.selectedNodeId,
        searchActive: explorer.searchActive,
        groupTestIdPrefix: "project",
        itemTestIdPrefix: "node",
        emptyTestIdPrefix: "empty",
        onGroupActivate: explorer.handleProjectToggle,
        onItemSelect: explorer.handleChildSelection,
      }),
    [
      expandedIds,
      explorer.filteredExplorerData,
      explorer.handleChildSelection,
      explorer.handleProjectToggle,
      explorer.searchActive,
      explorer.selectedNodeId,
    ],
  );

  if (explorer.isEmptyState) {
    return (
      <div className={styles.root}>
        <PageEmptyState
          icon={<FolderGit2 size={32} />}
          title="No projects yet"
          description="Open an existing project or create a linked one from the desktop app."
        />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <LeftMenuTree
        ariaLabel="Projects"
        entries={entries}
        onContextMenu={explorer.handleContextMenu}
        onKeyDown={explorer.handleKeyDown}
      />

      <ExplorerContextMenu actions={explorer.actions} />
      <ProjectListModals actions={explorer.actions} />
    </div>
  );
}
