import { useCallback } from "react";
import { Explorer, Spinner, PageEmptyState } from "@cypher-asi/zui";
import { Folder, FolderOpen } from "lucide-react";
import { useFileExplorerState } from "./useFileExplorerState";
import { MobileFileList } from "../../mobile/files/MobileFileList";
import { FileExplorerHeader } from "./FileExplorerHeader";
import { findNode } from "./useFileExplorerState";
import styles from "./FileExplorer.module.css";

export interface FileContextMenuInfo {
  path: string;
  name: string;
  isDir: boolean;
  isRoot: boolean;
  x: number;
  y: number;
}

interface FileExplorerProps {
  rootPath?: string;
  searchQuery?: string;
  onFileSelect?: (path: string) => void;
  remoteAgentId?: string;
  /** Increment externally to trigger a refresh (e.g. from a button in PanelSearch). */
  refreshTrigger?: number;
  /** Called when the user wants to create a new file in the given directory. */
  onCreateFile?: (dirPath: string) => void;
  onContextMenu?: (info: FileContextMenuInfo) => void;
}

export function FileExplorer({
  rootPath,
  searchQuery,
  onFileSelect,
  remoteAgentId,
  refreshTrigger,
  onCreateFile,
  onContextMenu,
}: FileExplorerProps) {
  const s = useFileExplorerState({
    rootPath,
    searchQuery,
    remoteAgentId,
    onFileSelect,
    refreshTrigger,
    onCreateFile,
  });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onContextMenu) return;
    let el = e.target as HTMLElement | null;
    while (el && el.getAttribute?.("role") !== "treeitem") el = el.parentElement;
    if (!el) return;
    const nodeId = el.id;
    if (!nodeId) return;
    e.preventDefault();
    const isRoot = nodeId === "__files_root__";
    const node = findNode(s.filteredData, nodeId);
    const isDir = isRoot || Boolean(node?.children);
    const name = isRoot
      ? (rootPath?.split(/[\\/]/).pop() ?? "root")
      : (node?.label ?? nodeId.split(/[\\/]/).pop() ?? nodeId);
    onContextMenu({ path: isRoot ? rootPath! : nodeId, name: String(name), isDir, isRoot, x: e.clientX, y: e.clientY });
  }, [onContextMenu, s.filteredData, rootPath]);

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
        title={getFileExplorerErrorTitle(s.isRemote)}
        description={getFileExplorerErrorDescription(s.error, s.isRemote)}
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
    <div
      className={styles.explorerContainer}
      data-explorer-scope="files"
      onContextMenu={handleContextMenu}
    >
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

export function getFileExplorerErrorTitle(isRemote: boolean): string {
  return isRemote ? "Files are temporarily unavailable" : "Could not load files";
}

export function getFileExplorerErrorDescription(error: string, isRemote: boolean): string {
  if (isRemote) {
    return "Remote files are temporarily unavailable. Try again in a moment.";
  }

  if (!error.trim()) {
    return "Files are temporarily unavailable. Try again in a moment.";
  }

  return error;
}
