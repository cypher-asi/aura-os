import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api, type DirEntry } from "../../api/client";
import { filterExplorerNodes } from "../../utils/filterExplorerNodes";
import { Explorer, Spinner, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Folder, File, FolderOpen } from "lucide-react";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useEventStore } from "../../stores/event-store";
import { EventType } from "../../types/aura-events";
import styles from "./FileExplorer.module.css";

interface FileExplorerProps {
  rootPath?: string;
  searchQuery?: string;
  onFileSelect?: (path: string) => void;
  remoteAgentId?: string;
  /** Increment externally to trigger a refresh (e.g. from a button in PanelSearch). */
  refreshTrigger?: number;
}

function toExplorerNodes(entries: DirEntry[]): ExplorerNode[] {
  return entries.map((entry) => ({
    id: entry.path,
    label: entry.name,
    icon: entry.is_dir ? <Folder size={14} /> : <File size={14} />,
    children: entry.children ? toExplorerNodes(entry.children) : undefined,
    metadata: { is_dir: entry.is_dir },
  }));
}

export function FileExplorer({ rootPath, searchQuery, onFileSelect, remoteAgentId, refreshTrigger }: FileExplorerProps) {
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

  // External refresh trigger from parent (e.g. button in PanelSearch)
  useEffect(() => {
    if (refreshTrigger != null && refreshTrigger > 0) {
      setRefreshKey((k) => k + 1);
    }
  }, [refreshTrigger]);

  // Event-driven refresh: re-fetch when agent modifies files
  useEffect(() => {
    const unsubs = [
      useEventStore.getState().subscribe(EventType.FileOpsApplied, triggerRefresh),
      useEventStore.getState().subscribe(EventType.TaskCompleted, triggerRefresh),
    ];
    return () => unsubs.forEach((u) => u());
  }, [triggerRefresh]);

  // Tab/window focus refresh: re-fetch when user returns to the page
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") triggerRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [triggerRefresh]);

  useEffect(() => {
    if (!rootPath) {
      return;
    }

    let cancelled = false;

    const fetchPromise = remoteAgentId
      ? api.swarm.listRemoteDirectory(remoteAgentId, rootPath)
      : api.listDirectory(rootPath);

    fetchPromise
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.entries) {
          setDirectoryState({
            key: rootPath,
            entries: res.entries,
            error: null,
          });
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
        setDirectoryState({
          key: rootPath,
          entries: [],
          error: e.message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [features.linkedWorkspace, remoteAgentId, rootPath, refreshKey]);

  const loading = Boolean(rootPath) && directoryState.key !== rootPath;
  const entries = useMemo(
    () => (rootPath && directoryState.key === rootPath ? directoryState.entries : []),
    [directoryState.entries, directoryState.key, rootPath],
  );
  const error = useMemo(
    () => (rootPath && directoryState.key === rootPath ? directoryState.error : null),
    [directoryState.error, directoryState.key, rootPath],
  );

  const explorerData: ExplorerNode[] = useMemo(() => {
    if (!rootPath) return [];
    const rootName = rootPath.split(/[\\/]/).pop() ?? rootPath;
    return [
      {
        id: "__files_root__",
        label: rootName,
        icon: <FolderOpen size={14} />,
        children: toExplorerNodes(entries),
      },
    ];
  }, [entries, rootPath]);

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery ?? ""),
    [explorerData, searchQuery],
  );

  const defaultExpandedIds = useMemo(() => ["__files_root__"], []);

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

  if (!canBrowseWorkspace) {
    return (
      <PageEmptyState
        icon={<FolderOpen size={32} />}
        title="No linked workspace"
        description="This project does not expose a live host folder to browse."
      />
    );
  }

  if (loading) {
    return (
      <div className={styles.loadingCenter}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <PageEmptyState
        icon={<Folder size={32} />}
        title="Could not load files"
        description={error}
      />
    );
  }

  if (entries.length === 0) {
    return (
      <PageEmptyState
        icon={<FolderOpen size={32} />}
        title="Empty directory"
        description="No files found in the project folder."
      />
    );
  }

  if (isMobileLayout) {
    return (
      <div className={styles.mobileScrollContainer}>
        <div className={styles.mobileFileList}>
          {renderMobileNodes({
            nodes: filteredData,
            features,
            isRemote,
            onFileSelect,
            rootPath,
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.explorerContainer}>
      <Explorer
        data={filteredData}
        expandOnSelect
        enableDragDrop={false}
        enableMultiSelect={false}
        defaultExpandedIds={defaultExpandedIds}
        onSelect={handleSelect}
      />
    </div>
  );
}

function renderMobileNodes({
  nodes,
  features,
  isRemote,
  onFileSelect,
  rootPath,
  depth = 0,
}: {
  nodes: ExplorerNode[];
  features: ReturnType<typeof useAuraCapabilities>["features"];
  isRemote: boolean;
  onFileSelect?: (path: string) => void;
  rootPath?: string;
  depth?: number;
}) {
  return nodes.map((node) => {
    const isDir = Boolean(node.children?.length) || node.metadata?.is_dir === true;
    const canPreviewFile = !isDir && Boolean(onFileSelect);
    const canOpenFile = !isDir && (canPreviewFile || (features.ideIntegration && !isRemote));
    const depthPadding = { paddingLeft: `${12 + depth * 16}px` };
    const actionLabel = canPreviewFile
      ? getMobilePreviewLabel(node.label)
      : canOpenFile
        ? "Open"
        : isDir
          ? "Folder"
          : "File";

    const content = (
      <div className={styles.mobileRowMain}>
        {node.icon}
        <span className={styles.truncatedLabel}>
          {node.label}
        </span>
      </div>
    );

    return (
      <div key={node.id} className={styles.mobileNodeGroup}>
        {canOpenFile ? (
          <button
            type="button"
            className={styles.mobileRow}
            style={{ ...depthPadding, cursor: "pointer" }}
            onClick={() => {
              if (onFileSelect) {
                onFileSelect(node.id);
              } else {
                api.openIde(node.id, rootPath);
              }
            }}
          >
            {content}
            <span className={styles.mobileRowMeta}>{actionLabel}</span>
          </button>
        ) : (
          <div className={styles.mobileRow} style={depthPadding}>
            {content}
            <span className={styles.mobileRowMeta}>{actionLabel}</span>
          </div>
        )}
        {node.children?.length ? renderMobileNodes({ nodes: node.children, features, isRemote, onFileSelect, rootPath, depth: depth + 1 }) : null}
      </div>
    );
  });
}

function getMobilePreviewLabel(filename: string): string {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    return "PDF";
  }

  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) {
    return "Image";
  }

  if (/\.(md|markdown)$/.test(lower)) {
    return "Read";
  }

  if (/\.(rs|ts|tsx|js|jsx|json|yaml|yml|toml|css|html|txt|sh|py|go|java|sql)$/.test(lower)) {
    return "Code";
  }

  return "Preview";
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
