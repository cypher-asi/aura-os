import { Explorer, PageEmptyState } from "@cypher-asi/zui";
import { FolderGit2 } from "lucide-react";
import { useProjectListData } from "./useProjectListData";
import { ProjectListModals } from "./ProjectListModals";
import { ExplorerContextMenu } from "./ExplorerContextMenu";
import { useProjectsExplorerModel } from "./project-list-projects-explorer";

import styles from "./ProjectList.module.css";

const explorerNodeStyles = {
  projectSuffix: styles.projectSuffix,
  newChatWrap: styles.newChatWrap,
  sessionIndicator: styles.sessionIndicator,
  automationSpinner: styles.automationSpinner,
  streamingDot: styles.streamingDot,
};

export function ProjectList() {
  const data = useProjectListData("projects");
  const explorer = useProjectsExplorerModel(data, explorerNodeStyles);

  if (explorer.isEmptyState) {
    return (
      <div className={styles.root}>
        <PageEmptyState icon={<FolderGit2 size={32} />} title="No projects yet" description="Open an existing project or create a linked one from the desktop app." />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div
        className={styles.explorerWrap}
        onContextMenu={explorer.handleContextMenu}
        onKeyDown={explorer.handleKeyDown}
      >
        <Explorer
          data={explorer.filteredExplorerData}
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultExpandedIds={explorer.defaultExpandedIds}
          defaultSelectedIds={explorer.defaultSelectedIds}
          onSelect={explorer.handleSelect}
          onExpand={explorer.handleExpand}
        />
      </div>

      <ExplorerContextMenu actions={explorer.actions} />
      <ProjectListModals actions={explorer.actions} />
    </div>
  );
}
