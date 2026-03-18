import { useEffect, useState, useMemo, useCallback } from "react";
import { api, type DirEntry } from "../api/client";
import { filterExplorerNodes } from "../utils/filterExplorerNodes";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Folder, File, FolderOpen } from "lucide-react";
import { EmptyState } from "./EmptyState";

interface FileExplorerProps {
  rootPath: string;
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

  useEffect(() => {
    if (!rootPath) return;
    setLoading(true);
    setError(null);
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
  }, [rootPath]);

  const explorerData: ExplorerNode[] = useMemo(() => {
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
    [filteredData, onFileSelect],
  );

  if (loading) return null;

  if (error) {
    return <EmptyState icon={<Folder size={32} />}>Could not load files</EmptyState>;
  }

  if (entries.length === 0) {
    return <EmptyState icon={<FolderOpen size={32} />}>No files found in the project folder.</EmptyState>;
  }

  return (
    <Explorer
      data={filteredData}
      expandOnSelect
      enableDragDrop={false}
      enableMultiSelect={false}
      defaultExpandedIds={defaultExpandedIds}
      onSelect={handleSelect}
    />
  );
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
