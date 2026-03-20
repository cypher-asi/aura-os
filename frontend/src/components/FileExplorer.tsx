import { useEffect, useState, useMemo, useCallback } from "react";
import { api, type DirEntry } from "../api/client";
import { filterExplorerNodes } from "../utils/filterExplorerNodes";
import { Explorer, Spinner, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Folder, File, FolderOpen } from "lucide-react";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";

interface FileExplorerProps {
  rootPath?: string;
  searchQuery?: string;
  onFileSelect?: (path: string) => void;
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

export function FileExplorer({ rootPath, searchQuery, onFileSelect }: FileExplorerProps) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { features, isMobileLayout } = useAuraCapabilities();
  const canBrowseWorkspace = Boolean(rootPath);

  useEffect(() => {
    if (!rootPath) {
      const frame = window.requestAnimationFrame(() => {
        setEntries([]);
        setError(null);
        setLoading(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const frame = window.requestAnimationFrame(() => {
      setLoading(true);
      setError(null);
    });
    api
      .listDirectory(rootPath)
      .then((res) => {
        if (res.ok && res.entries) {
          setEntries(res.entries);
        } else {
          setError(res.error ?? "Failed to list directory");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => window.cancelAnimationFrame(frame);
  }, [features.linkedWorkspace, rootPath]);

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
      if (!features.linkedWorkspace) return;
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
    [features.linkedWorkspace, filteredData, onFileSelect, rootPath],
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
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-8)" }}>
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
      <div style={{ display: "flex", flex: 1, minHeight: 0, height: "100%", width: "100%", overflowY: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", width: "100%", padding: "var(--space-2)" }}>
          {renderMobileNodes({
            nodes: filteredData,
            features,
            onFileSelect,
            rootPath,
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, height: "100%", width: "100%" }}>
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
  onFileSelect,
  rootPath,
  depth = 0,
}: {
  nodes: ExplorerNode[];
  features: ReturnType<typeof useAuraCapabilities>["features"];
  onFileSelect?: (path: string) => void;
  rootPath?: string;
  depth?: number;
}) {
  return nodes.map((node) => {
    const isDir = Boolean(node.children?.length) || node.metadata?.is_dir === true;
    const canOpenFile = !isDir && (Boolean(onFileSelect) || features.ideIntegration);
    const rowStyle = {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      width: "100%",
      padding: "10px 12px",
      paddingLeft: `${12 + depth * 16}px`,
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--color-border-subtle)",
      background: "var(--color-panel-solid)",
      color: "inherit",
      textAlign: "left" as const,
    };

    const content = (
      <>
        {node.icon}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.label}
        </span>
      </>
    );

    return (
      <div key={node.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {canOpenFile ? (
          <button
            type="button"
            style={{ ...rowStyle, cursor: "pointer" }}
            onClick={() => {
              if (onFileSelect) {
                onFileSelect(node.id);
              } else {
                api.openIde(node.id, rootPath);
              }
            }}
          >
            {content}
          </button>
        ) : (
          <div style={rowStyle}>
            {content}
          </div>
        )}
        {node.children?.length ? renderMobileNodes({ nodes: node.children, features, onFileSelect, rootPath, depth: depth + 1 }) : null}
      </div>
    );
  });
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
