import { useEffect, useState, useMemo, useCallback, useRef, createElement } from "react";
import { api, type DirEntry } from "../../api/client";
import { filterExplorerNodes } from "../../shared/utils/filterExplorerNodes";
import type { ListTreeNode } from "../../components/ListTree";
import { Folder, File, FolderOpen, FolderOutput } from "lucide-react";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useEventStore } from "../../stores/event-store/index";
import { EventType } from "../../shared/types/aura-events";
import styles from "./FileExplorer.module.css";
import type { HostedWorkspaceTarget } from "../../shared/api/hosted-workspace";

function toExplorerNodes(entries: DirEntry[]): ListTreeNode[] {
  return entries.map((entry) => ({
    id: entry.path,
    label: entry.name,
    icon: entry.is_dir
      ? createElement(Folder, { size: 14 })
      : createElement(File, { size: 14 }),
    children: entry.children ? toExplorerNodes(entry.children) : undefined,
    metadata: { is_dir: entry.is_dir },
  }));
}

export function useFileExplorerState({
  rootPath,
  searchQuery,
  remoteAgentId,
  hostedWorkspace,
  rootLabel,
  onFileSelect,
  refreshTrigger,
}: {
  rootPath?: string;
  searchQuery?: string;
  remoteAgentId?: string;
  hostedWorkspace?: HostedWorkspaceTarget;
  rootLabel?: string;
  onFileSelect?: (path: string) => void;
  refreshTrigger?: number;
}) {
  const [directoryState, setDirectoryState] = useState<{
    key: string | null;
    entries: DirEntry[];
    error: string | null;
  }>({
    key: null,
    entries: [],
    error: null,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const { features, isMobileLayout } = useAuraCapabilities();
  const hostedProjectId = hostedWorkspace?.projectId;
  const hostedAgentInstanceId = hostedWorkspace?.agentInstanceId;
  const hostedTarget = useMemo(
    () =>
      hostedProjectId && hostedAgentInstanceId
        ? { projectId: hostedProjectId, agentInstanceId: hostedAgentInstanceId }
        : undefined,
    [hostedAgentInstanceId, hostedProjectId],
  );
  const canBrowseWorkspace = Boolean(rootPath || hostedTarget);
  const isRemote = Boolean(remoteAgentId);
  const isHosted = Boolean(hostedTarget);
  const workspaceKey = hostedTarget
    ? `hosted:${hostedTarget.projectId}:${hostedTarget.agentInstanceId}`
    : rootPath ?? null;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 500);
  }, []);

  useEffect(() => {
    if (refreshTrigger != null && refreshTrigger > 0) {
      setRefreshKey((k) => k + 1);
    }
  }, [refreshTrigger]);

  useEffect(() => {
    const unsubs = [
      useEventStore
        .getState()
        .subscribe(EventType.FileOpsApplied, triggerRefresh),
      useEventStore
        .getState()
        .subscribe(EventType.TaskCompleted, triggerRefresh),
    ];
    return () => unsubs.forEach((u) => u());
  }, [triggerRefresh]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") triggerRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [triggerRefresh]);

  // Keep the files list feeling live without a dedicated backend watcher:
  // while the tab/window is visible and a workspace is wired up, re-fetch
  // local/remote listings every 3s. Hosted trees traverse a network boundary
  // and can be recursive, so they use a 10s cadence. debounceRef coalesces
  // overlapping event/manual/interval triggers in both cases.
  useEffect(() => {
    if (!workspaceKey) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId != null) return;
      intervalId = setInterval(triggerRefresh, isHosted ? 10_000 : 3000);
    };
    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [isHosted, triggerRefresh, workspaceKey]);

  useEffect(() => {
    if (!workspaceKey) return;

    let cancelled = false;

    const fetchPromise = hostedTarget
      ? api.hostedWorkspace.listFiles(hostedTarget)
      : remoteAgentId && rootPath
        ? api.swarm.listRemoteDirectory(remoteAgentId, rootPath)
        : rootPath
          ? api.listDirectory(rootPath)
          : Promise.resolve({
              ok: false,
              entries: undefined as DirEntry[] | undefined,
              error: "No workspace selected",
            });

    fetchPromise
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.entries) {
          setDirectoryState({ key: workspaceKey, entries: res.entries, error: null });
          return;
        }
        setDirectoryState({
          key: workspaceKey,
          entries: [],
          error: res.error ?? "Failed to list directory",
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setDirectoryState({ key: workspaceKey, entries: [], error: e.message });
      });

    return () => {
      cancelled = true;
    };
  }, [features.linkedWorkspace, hostedTarget, remoteAgentId, refreshKey, rootPath, workspaceKey]);

  const loading = Boolean(workspaceKey) && directoryState.key !== workspaceKey;
  const entries = useMemo(
    () =>
      workspaceKey && directoryState.key === workspaceKey
        ? directoryState.entries
        : [],
    [directoryState.entries, directoryState.key, workspaceKey],
  );
  const error = useMemo(
    () =>
      workspaceKey && directoryState.key === workspaceKey
        ? directoryState.error
        : null,
    [directoryState.error, directoryState.key, workspaceKey],
  );

  const showOpenFolder = features.linkedWorkspace && !isRemote && !isHosted;

  const handleOpenInExplorer = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (rootPath) api.openPath(rootPath);
    },
    [rootPath],
  );

  const explorerData: ListTreeNode[] = useMemo(() => {
    if (!workspaceKey) return [];
    const rootName = rootLabel ?? rootPath?.split(/[\\/]/).pop() ?? "Project files";
    return [
      {
        id: "__files_root__",
        label: rootName,
        icon: createElement(FolderOpen, { size: 14 }),
        children: toExplorerNodes(entries),
        status: showOpenFolder
          ? createElement(
              "button",
              {
                type: "button",
                className: styles.openFolderButton,
                onClick: handleOpenInExplorer,
                title: "Open in file explorer",
                "aria-label": "Open in file explorer",
              },
              createElement(FolderOutput, { size: 13 }),
            )
          : undefined,
      },
    ];
  }, [entries, rootLabel, rootPath, showOpenFolder, handleOpenInExplorer, workspaceKey]);

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery ?? ""),
    [explorerData, searchQuery],
  );

  const defaultExpandedIds = useMemo(() => {
    const ids: string[] = ["__files_root__"];
    const collectFolderIds = (nodes: ListTreeNode[]) => {
      for (const node of nodes) {
        if (node.children) {
          ids.push(node.id);
          collectFolderIds(node.children);
        }
      }
    };
    collectFolderIds(explorerData);
    return ids;
  }, [explorerData]);

  const handleSelect = useCallback(
    (node: ListTreeNode) => {
      if (!features.linkedWorkspace && !isRemote && !isHosted) return;
      if (node.id === "__files_root__" || node.children) return;
      if (onFileSelect) {
        onFileSelect(node.id);
      } else {
        api.openIde(node.id, rootPath);
      }
    },
    [features.linkedWorkspace, isHosted, isRemote, onFileSelect, rootPath],
  );

  return {
    canBrowseWorkspace,
    isRemote,
    isHosted,
    loading,
    entries,
    error,
    features,
    isMobileLayout,
    filteredData,
    defaultExpandedIds,
    handleSelect,
    rootPath,
  };
}
