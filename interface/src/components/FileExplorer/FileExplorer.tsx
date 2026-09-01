import { useCallback, useMemo, useState } from "react";
import { Spinner, PageEmptyState } from "@cypher-asi/zui";
import { Folder, FolderOpen } from "lucide-react";
import { ListTree } from "../ListTree";
import {
  FILE_EXPLORER_ROOT_ID,
  useFileExplorerState,
} from "./useFileExplorerState";
import { MobileFileList } from "../../mobile/files/MobileFileList";
import { FileExplorerHeader } from "./FileExplorerHeader";
import {
  getFileExplorerErrorDescription,
  getFileExplorerErrorTitle,
} from "./fileExplorerErrors";
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

  return (
    <FileExplorerContent
      key={
        hostedWorkspace
          ? `hosted:${hostedWorkspace.projectId}:${hostedWorkspace.agentInstanceId}`
          : `${remoteAgentId ?? "local"}:${rootPath ?? ""}`
      }
      state={s}
      rootPath={rootPath}
      rootLabel={rootLabel}
      searchQuery={searchQuery}
      onFileSelect={onFileSelect}
    />
  );
}

type FileExplorerReadyState = ReturnType<typeof useFileExplorerState>;

function FileExplorerContent({
  state: s,
  rootPath,
  rootLabel,
  searchQuery,
  onFileSelect,
}: {
  state: FileExplorerReadyState;
  rootPath?: string;
  rootLabel?: string;
  searchQuery?: string;
  onFileSelect?: (path: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<string[]>(s.defaultExpandedIds);
  const availableFolderIds = useMemo(() => new Set(s.folderIds), [s.folderIds]);
  const retainedExpandedIds = useMemo(
    () => expandedIds.filter((id) => availableFolderIds.has(id)),
    [availableFolderIds, expandedIds],
  );
  const effectiveExpandedIds = useMemo(() => {
    if (!searchQuery?.trim()) return retainedExpandedIds;
    return [...new Set([...retainedExpandedIds, ...s.filteredFolderIds])];
  }, [retainedExpandedIds, s.filteredFolderIds, searchQuery]);

  const handleExpand = useCallback((nodeId: string, expanded: boolean) => {
    setExpandedIds((current) => {
      if (expanded) {
        return current.includes(nodeId) ? current : [...current, nodeId];
      }
      return current.filter((id) => id !== nodeId);
    });
  }, []);

  const handleExpandAll = useCallback(() => setExpandedIds(s.folderIds), [s.folderIds]);
  const handleCollapseAll = useCallback(
    () => setExpandedIds([FILE_EXPLORER_ROOT_ID]),
    [],
  );
  const searchActive = Boolean(searchQuery?.trim());
  const canExpandAll =
    !searchActive && s.folderIds.some((id) => !retainedExpandedIds.includes(id));
  const canCollapseAll =
    !searchActive && retainedExpandedIds.some((id) => id !== FILE_EXPLORER_ROOT_ID);
  const displayRoot = rootLabel ?? rootPath;
  const header = displayRoot ? (
    <FileExplorerHeader
      rootPath={displayRoot}
      onExpandAll={handleExpandAll}
      onCollapseAll={handleCollapseAll}
      canExpandAll={canExpandAll}
      canCollapseAll={canCollapseAll}
    />
  ) : null;

  if (s.isMobileLayout) {
    return (
      <>
        {header}
        <MobileFileList
          nodes={s.filteredData}
          features={s.features}
          isRemote={s.isRemote}
          onFileSelect={onFileSelect}
          rootPath={rootPath}
          expandedIds={new Set(effectiveExpandedIds)}
          onToggleDirectory={(nodeId) =>
            handleExpand(nodeId, !effectiveExpandedIds.includes(nodeId))
          }
        />
      </>
    );
  }

  return (
    <div className={styles.explorerContainer}>
      {header}
      <ListTree
        nodes={s.filteredData}
        expandOnSelect
        expandedIds={effectiveExpandedIds}
        onExpand={handleExpand}
        onSelect={s.handleSelect}
      />
    </div>
  );
}
