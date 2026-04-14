import { PageEmptyState } from "@cypher-asi/zui";
import { FolderGit2 } from "lucide-react";
import { ProjectListModals } from "../../../../components/ProjectList/ProjectListModals";
import { ExplorerContextMenu } from "../../../../components/ProjectList/ExplorerContextMenu";
import { LeftMenuTree } from "../../../../features/left-menu";
import styles from "../../../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css";
import { useTasksProjectListModel } from "./use-tasks-project-list-model";

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

export function TasksProjectList() {
  const model = useTasksProjectListModel(explorerNodeStyles);

  if (model.isEmptyState) {
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
        ariaLabel="Tasks"
        entries={model.entries}
        onContextMenu={model.handleContextMenu}
        onKeyDown={model.handleKeyDown}
      />

      <ExplorerContextMenu actions={model.actions} />
      <ProjectListModals actions={model.actions} />
    </div>
  );
}
