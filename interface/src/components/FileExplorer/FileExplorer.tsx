import { Spinner, PageEmptyState } from "@cypher-asi/zui";
import { Folder, FolderOpen } from "lucide-react";
import { ListTree } from "../ListTree";
import { useFileExplorerState } from "./useFileExplorerState";
import { MobileFileList } from "../../mobile/files/MobileFileList";
import { FileExplorerHeader } from "./FileExplorerHeader";
import styles from "./FileExplorer.module.css";
import type { HostedWorkspaceTarget } from "../../shared/api/hosted-workspace";

interface FileExplorerProps {
  rootPath?: string;
  searchQuery?: string;
  onFileSelect?: (path: string) => void;
  remoteAgentId?: string;
  hostedWorkspace?: HostedWorkspaceTarget;
  rootLabel?: string;
  /** Increment externally to trigger a refresh (e.g. from a button in PanelSearch). */
  refreshTrigger?: number;
}

export function FileExplorer({
  rootPath,
  searchQuery,
  onFileSelect,
  remoteAgentId,
  hostedWorkspace,
  rootLabel,
  refreshTrigger,
}: FileExplorerProps) {
  const s = useFileExplorerState({
    rootPath,
    searchQuery,
    remoteAgentId,
    hostedWorkspace,
    rootLabel,
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
        title={getFileExplorerErrorTitle(s.isRemote, s.isHosted)}
        description={getFileExplorerErrorDescription(s.error, s.isRemote, s.isHosted)}
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
        {(rootLabel || rootPath) && <FileExplorerHeader rootPath={rootLabel ?? rootPath ?? ""} />}
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
      {(rootLabel || rootPath) && <FileExplorerHeader rootPath={rootLabel ?? rootPath ?? ""} />}
      <ListTree
        nodes={s.filteredData}
        expandOnSelect
        defaultExpandedIds={s.defaultExpandedIds}
        onSelect={s.handleSelect}
      />
    </div>
  );
}

export function getFileExplorerErrorTitle(isRemote: boolean, isHosted = false): string {
  return isRemote || isHosted ? "Files are temporarily unavailable" : "Could not load files";
}

export function getFileExplorerErrorDescription(error: string, isRemote: boolean, isHosted = false): string {
  if (isHosted) {
    return "Agent workspace files are temporarily unavailable. Try again in a moment.";
  }
  if (isRemote) {
    return "Remote files are temporarily unavailable. Try again in a moment.";
  }

  if (!error.trim()) {
    return "Files are temporarily unavailable. Try again in a moment.";
  }

  return error;
}
