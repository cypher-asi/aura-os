import { useEffect, useState, useMemo, useCallback, useRef, createElement } from "react";
import { api, type DirEntry } from "../../api/client";
import { filterExplorerNodes } from "../../utils/filterExplorerNodes";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Folder, File, FolderOpen, FolderOutput } from "lucide-react";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useEventStore } from "../../stores/event-store/index";
import { EventType } from "../../shared/types/aura-events";
import styles from "./FileExplorer.module.css";
import type { ExplorerNodeWithSuffix } from "../../lib/zui-compat";

function toExplorerNodes(entries: DirEntry[]): ExplorerNode[] {
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
  onFileSelect,
  refreshTrigger,
}: {
  rootPath?: string;
  searchQuery?: string;
  remoteAgentId?: string;
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
  const canBrowseWorkspace = Boolean(rootPath);
  const isRemote = Boolean(remoteAgentId);
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
  // the directory listing every 3s. The backend call is a cheap listing
  // and debounceRef already coalesces overlapping triggers.
  useEffect(() => {
    if (!rootPath) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId != null) return;
      intervalId = setInterval(triggerRefresh, 3000);
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
  }, [rootPath, triggerRefresh]);

  useEffect(() => {
    if (!rootPath) return;

    let cancelled = false;

    const fetchPromise = remoteAgentId
      ? api.swarm.listRemoteDirectory(remoteAgentId, rootPath)
      : api.listDirectory(rootPath);

    fetchPromise
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.entries) {
          setDirectoryState({ key: rootPath, entries: res.entries, error: null });
          return;
        }
        setDirectoryState({
          key: rootPath,
          entries: [],
          error: res.error ?? "Failed to list directory",
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setDirectoryState({ key: rootPath, entries: [], error: e.message });
      });

    return () => {
      cancelled = true;
    };
  }, [features.linkedWorkspace, remoteAgentId, rootPath, refreshKey]);

  const loading = Boolean(rootPath) && directoryState.key !== rootPath;
  const entries = useMemo(
    () =>
      rootPath && directoryState.key === rootPath
        ? directoryState.entries
        : [],
    [directoryState.entries, directoryState.key, rootPath],
  );
  const error = useMemo(
    () =>
      rootPath && directoryState.key === rootPath
        ? directoryState.error
        : null,
    [directoryState.error, directoryState.key, rootPath],
  );

  const showOpenFolder = features.linkedWorkspace && !isRemote;

  const handleOpenInExplorer = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (rootPath) api.openPath(rootPath);
    },
    [rootPath],
  );

  const explorerData: ExplorerNodeWithSuffix[] = useMemo(() => {
    if (!rootPath) return [];
    const rootName = rootPath.split(/[\\/]/).pop() ?? rootPath;
    return [
      {
        id: "__files_root__",
        label: rootName,
        icon: createElement(FolderOpen, { size: 14 }),
        children: toExplorerNodes(entries),
        suffix: showOpenFolder
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
  }, [entries, rootPath, showOpenFolder, handleOpenInExplorer]);

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery ?? ""),
    [explorerData, searchQuery],
  );

  const defaultExpandedIds = useMemo(() => {
    const ids: string[] = ["__files_root__"];
    const collectFolderIds = (nodes: ExplorerNode[]) => {
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
    (ids: string[]) => {
      if (!features.linkedWorkspace && !isRemote) return;
      const id = ids[0];
      if (!id || id === "__files_root__") return;
      const node = findNode(filteredData, id);
      if (node && !node.children) {
        if (onFileSelect) {
          onFileSelect(id);
        } else {
          api.openIde(id, rootPath);
        }
      }
    },
    [features.linkedWorkspace, isRemote, filteredData, onFileSelect, rootPath],
  );

  return {
    canBrowseWorkspace,
    isRemote,
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

function findNode(nodes: ExplorerNode[], id: string): ExplorerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
