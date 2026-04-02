import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { ButtonPlus, Explorer, Menu, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { Cpu, FolderOpen, Pencil, Trash2, FolderPlus } from "lucide-react";
import { useProcessStore } from "../stores/process-store";
import { useSidebarSearch } from "../../../context/SidebarSearchContext";
import { processApi } from "../../../api/process";
import { ProcessForm } from "./ProcessForm";
import { ProcessFolderForm } from "./ProcessFolderForm";

import styles from "../../../components/ProjectList/ProjectList.module.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterTree(nodes: ExplorerNode[], q: string): ExplorerNode[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  return nodes.reduce<ExplorerNode[]>((acc, node) => {
    const labelMatch = node.label.toLowerCase().includes(lower);
    const filteredChildren = node.children ? filterTree(node.children, q) : [];
    if (labelMatch) acc.push(node);
    else if (filteredChildren.length > 0) acc.push({ ...node, children: filteredChildren });
    return acc;
  }, []);
}

function getLastSelectedId(ids: Iterable<string>): string | null {
  let selectedId: string | null = null;
  for (const id of ids) selectedId = id;
  return selectedId;
}

// ---------------------------------------------------------------------------
// Context-menu items
// ---------------------------------------------------------------------------

const folderMenuItems: MenuItem[] = [
  { id: "add-process", label: "Add Process", icon: <Cpu size={14} /> },
  { id: "rename-folder", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete-folder", label: "Delete", icon: <Trash2 size={14} /> },
];

const processMenuItems: MenuItem[] = [
  { id: "rename-process", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete-process", label: "Delete", icon: <Trash2 size={14} /> },
];

// ---------------------------------------------------------------------------
// + button menu items
// ---------------------------------------------------------------------------

const addMenuItems: MenuItem[] = [
  { id: "new-process", label: "New Process", icon: <Cpu size={14} /> },
  { id: "new-folder", label: "New Folder", icon: <FolderPlus size={14} /> },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type CtxMenuState = {
  x: number;
  y: number;
  folderId?: string;
  processId?: string;
};

export function ProcessList() {
  const processes = useProcessStore((s) => s.processes);
  const folders = useProcessStore((s) => s.folders);
  const loading = useProcessStore((s) => s.loading);
  const updateProcess = useProcessStore((s) => s.updateProcess);
  const removeProcess = useProcessStore((s) => s.removeProcess);
  const updateFolder = useProcessStore((s) => s.updateFolder);
  const removeFolder = useProcessStore((s) => s.removeFolder);
  const navigate = useNavigate();
  const { processId } = useParams<{ processId: string }>();
  const { query: searchQuery, setAction } = useSidebarSearch();

  const [showProcessForm, setShowProcessForm] = useState(false);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [processFormFolderId, setProcessFormFolderId] = useState<string | null>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  // Close add menu on outside click
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuAnchor) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuAnchor(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuAnchor]);

  // Sidebar + button
  useEffect(() => {
    setAction(
      "process",
      <ButtonPlus
        onClick={(e: React.MouseEvent) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAddMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
        size="sm"
        title="New..."
      />,
    );
    return () => setAction("process", null);
  }, [setAction]);

  const handleAddMenuAction = useCallback((id: string) => {
    setAddMenuAnchor(null);
    if (id === "new-process") { setProcessFormFolderId(null); setShowProcessForm(true); }
    if (id === "new-folder") setShowFolderForm(true);
  }, []);

  // Build folder map for quick lookup
  const folderMap = useMemo(() => new Map(folders.map((f) => [f.folder_id, f])), [folders]);

  // Build process map
  const processMap = useMemo(() => new Map(processes.map((p) => [p.process_id, p])), [processes]);

  // Group processes by folder
  const processesByFolder = useMemo(() => {
    const map: Record<string, typeof processes> = {};
    for (const p of processes) {
      const key = p.folder_id ?? "__root__";
      (map[key] ??= []).push(p);
    }
    return map;
  }, [processes]);

  // Build explorer data
  const explorerData: ExplorerNode[] = useMemo(() => {
    const folderNodes: ExplorerNode[] = folders.map((f) => {
      const children: ExplorerNode[] = (processesByFolder[f.folder_id] ?? []).map((p) => ({
        id: p.process_id,
        label: p.name,
        icon: <Cpu size={16} />,
        suffix: (
          <span className={styles.sessionIndicator}>
            <span
              style={{
                width: 6, height: 6, borderRadius: "50%", display: "inline-block",
                background: p.enabled ? "var(--color-success)" : "var(--color-text-muted)",
              }}
            />
          </span>
        ),
        metadata: { type: "process", folderId: f.folder_id },
      }));

      return {
        id: f.folder_id,
        label: f.name,
        suffix: (
          <span className={styles.projectSuffix}>
            <span onClick={(e) => e.stopPropagation()} className={styles.newChatWrap}>
              <ButtonPlus
                onClick={() => { setProcessFormFolderId(f.folder_id); setShowProcessForm(true); }}
                size="sm"
                title="Add Process"
              />
            </span>
          </span>
        ),
        metadata: { type: "folder" },
        children,
      };
    });

    const rootProcesses: ExplorerNode[] = (processesByFolder["__root__"] ?? []).map((p) => ({
      id: p.process_id,
      label: p.name,
      icon: <Cpu size={16} />,
      suffix: (
        <span className={styles.sessionIndicator}>
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%", display: "inline-block",
              background: p.enabled ? "var(--color-success)" : "var(--color-text-muted)",
            }}
          />
        </span>
      ),
      metadata: { type: "process", folderId: null },
    }));

    return [...folderNodes, ...rootProcesses];
  }, [folders, processesByFolder]);

  const filteredExplorerData = useMemo(() => filterTree(explorerData, searchQuery), [explorerData, searchQuery]);
  const defaultExpandedIds = useMemo(() => folders.map((f) => f.folder_id), [folders]);
  const defaultSelectedIds = useMemo(() => (processId ? [processId] : []), [processId]);

  const handleSelect = useCallback((ids: Iterable<string>) => {
    const id = getLastSelectedId(ids);
    if (!id) return;
    if (processMap.has(id)) {
      navigate(`/process/${id}`);
    }
  }, [processMap, navigate]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("button[id]");
    if (!target) return;
    const nodeId = target.id;
    if (folderMap.has(nodeId)) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, folderId: nodeId });
    } else if (processMap.has(nodeId)) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, processId: nodeId });
    }
  }, [folderMap, processMap]);

  const handleCtxMenuAction = useCallback(async (id: string) => {
    if (!ctxMenu) return;

    if (id === "add-process" && ctxMenu.folderId) {
      setProcessFormFolderId(ctxMenu.folderId);
      setShowProcessForm(true);
    }

    if (id === "rename-folder" && ctxMenu.folderId) {
      const folder = folderMap.get(ctxMenu.folderId);
      if (!folder) return;
      const newName = window.prompt("Rename folder", folder.name);
      if (newName && newName.trim() && newName.trim() !== folder.name) {
        try {
          const updated = await processApi.updateFolder(folder.folder_id, { name: newName.trim() });
          updateFolder(updated);
        } catch { /* ignore */ }
      }
    }

    if (id === "delete-folder" && ctxMenu.folderId) {
      const folder = folderMap.get(ctxMenu.folderId);
      if (!folder) return;
      if (window.confirm(`Delete folder "${folder.name}"? Processes inside will be moved to the root.`)) {
        try {
          await processApi.deleteFolder(folder.folder_id);
          removeFolder(folder.folder_id);
        } catch { /* ignore */ }
      }
    }

    if (id === "rename-process" && ctxMenu.processId) {
      const proc = processMap.get(ctxMenu.processId);
      if (!proc) return;
      const newName = window.prompt("Rename process", proc.name);
      if (newName && newName.trim() && newName.trim() !== proc.name) {
        try {
          const updated = await processApi.updateProcess(proc.process_id, { name: newName.trim() });
          updateProcess(updated);
        } catch { /* ignore */ }
      }
    }

    if (id === "delete-process" && ctxMenu.processId) {
      const proc = processMap.get(ctxMenu.processId);
      if (!proc) return;
      if (window.confirm(`Delete process "${proc.name}"?`)) {
        try {
          await processApi.deleteProcess(proc.process_id);
          removeProcess(proc.process_id);
          if (processId === proc.process_id) navigate("/process");
        } catch { /* ignore */ }
      }
    }

    setCtxMenu(null);
  }, [ctxMenu, folderMap, processMap, updateFolder, removeFolder, updateProcess, removeProcess, navigate, processId]);

  // Empty state
  if (!loading && processes.length === 0 && folders.length === 0) {
    return (
      <div className={styles.root}>
        <PageEmptyState
          icon={<FolderOpen size={32} />}
          title="No processes yet"
          description="Create a process to build automated workflows."
        />
        {showProcessForm && <ProcessForm onClose={() => setShowProcessForm(false)} folderId={processFormFolderId} />}
        {showFolderForm && <ProcessFolderForm onClose={() => setShowFolderForm(false)} />}
        {addMenuAnchor && createPortal(
          <div ref={addMenuRef} style={{ position: "fixed", left: addMenuAnchor.x, top: addMenuAnchor.y, zIndex: 9999 }}>
            <Menu items={addMenuItems} onChange={handleAddMenuAction} background="solid" border="solid" rounded="md" width={180} isOpen />
          </div>,
          document.body,
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.explorerWrap} onContextMenu={handleContextMenu}>
        <Explorer
          data={filteredExplorerData}
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultExpandedIds={defaultExpandedIds}
          defaultSelectedIds={defaultSelectedIds}
          onSelect={handleSelect}
        />
      </div>

      {ctxMenu && createPortal(
        <div ref={ctxMenuRef} className={styles.contextMenuOverlay} style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <Menu
            items={ctxMenu.folderId ? folderMenuItems : processMenuItems}
            onChange={handleCtxMenuAction}
            background="solid"
            border="solid"
            rounded="md"
            width={180}
            isOpen
          />
        </div>,
        document.body,
      )}

      {addMenuAnchor && createPortal(
        <div ref={addMenuRef} style={{ position: "fixed", left: addMenuAnchor.x, top: addMenuAnchor.y, zIndex: 9999 }}>
          <Menu items={addMenuItems} onChange={handleAddMenuAction} background="solid" border="solid" rounded="md" width={180} isOpen />
        </div>,
        document.body,
      )}

      {showProcessForm && <ProcessForm onClose={() => setShowProcessForm(false)} folderId={processFormFolderId} />}
      {showFolderForm && <ProcessFolderForm onClose={() => setShowFolderForm(false)} />}
    </div>
  );
}
