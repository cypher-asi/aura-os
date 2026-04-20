import { Explorer, Spinner, PageEmptyState } from "@cypher-asi/zui";
import { Folder, FolderOpen } from "lucide-react";
import { useFileExplorerState } from "./useFileExplorerState";
import { MobileFileList } from "./MobileFileList";
import { FileExplorerHeader } from "./FileExplorerHeader";
import styles from "./FileExplorer.module.css";

interface FileExplorerProps {
  rootPath?: string;
  searchQuery?: string;
  onFileSelect?: (path: string) => void;
  remoteAgentId?: string;
  /** Increment externally to trigger a refresh (e.g. from a button in PanelSearch). */
  refreshTrigger?: number;
}

export function FileExplorer({
  rootPath,
  searchQuery,
  onFileSelect,
  remoteAgentId,
  refreshTrigger,
}: FileExplorerProps) {
  const s = useFileExplorerState({
    rootPath,
    searchQuery,
    remoteAgentId,
    onFileSelect,
    refreshTrigger,
  });

  if (!s.canBrowseWorkspace) {
    return (
      <PageEmptyState
        icon={<FolderOpen size={32} />}
        title="No agent workspace"
        description="This view does not have a live agent workspace to browse."
      />
    );
  }

  if (s.loading) {
    return (
      <div className={styles.loadingCenter}>
        <Spinner size="md" />
      </div>
    );
  }

  if (s.error) {
    return (
      <PageEmptyState
        icon={<Folder size={32} />}
        title="Could not load files"
        description={s.error}
      />
    );
  }

  if (s.entries.length === 0) {
    return (
      <PageEmptyState
        icon={<FolderOpen size={32} />}
        title="Empty directory"
        description="No files found in the project folder."
      />
    );
  }

  if (s.isMobileLayout) {
    return (
      <>
        {rootPath && <FileExplorerHeader rootPath={rootPath} />}
        <MobileFileList
          nodes={s.filteredData}
          features={s.features}
          isRemote={s.isRemote}
          onFileSelect={onFileSelect}
          rootPath={rootPath}
        />
      </>
    );
  }

  return (
    <div className={styles.explorerContainer}>
      {rootPath && <FileExplorerHeader rootPath={rootPath} />}
      <Explorer
        data={s.filteredData}
        expandOnSelect
        enableDragDrop={false}
        enableMultiSelect={false}
        defaultExpandedIds={s.defaultExpandedIds}
        onSelect={s.handleSelect}
      />
    </div>
  );
}
