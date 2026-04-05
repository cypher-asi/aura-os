import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ButtonPlus } from "@cypher-asi/zui";
import type { ExplorerNode, DropPosition } from "@cypher-asi/zui";
import { Cpu } from "lucide-react";
import { useProcessStore, LAST_PROCESS_ID_KEY } from "../../stores/process-store";
import { useSidebarSearch } from "../../../../hooks/use-sidebar-search";
import { processApi } from "../../../../api/process";
import type { InlineRenameTarget } from "../../../../components/InlineRenameInput";

import styles from "../../../../components/ProjectList/ProjectList.module.css";

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
    else if (filteredChildren.length > 0)
      acc.push({ ...node, children: filteredChildren });
    return acc;
  }, []);
}

function getLastSelectedId(ids: Iterable<string>): string | null {
  let selectedId: string | null = null;
  for (const id of ids) selectedId = id;
  return selectedId;
}

// ---------------------------------------------------------------------------
// State hook
// ---------------------------------------------------------------------------

type CtxMenuState = {
  x: number;
  y: number;
  folderId?: string;
  processId?: string;
};

export type RenameTargetExt = InlineRenameTarget & {
  kind: "folder" | "process";
};

export function useProcessListState() {
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
  const [processFormFolderId, setProcessFormFolderId] = useState<string | null>(
    null,
  );
  const [addMenuAnchor, setAddMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTargetExt | null>(
    null,
  );
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        ctxMenuRef.current &&
        !ctxMenuRef.current.contains(e.target as Node)
      )
        setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  // Close add menu on outside click
  useEffect(() => {
    if (!addMenuAnchor) return;
    const handler = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      )
        setAddMenuAnchor(null);
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
    if (id === "new-process") {
      setProcessFormFolderId(null);
      setShowProcessForm(true);
    }
    if (id === "new-folder") setShowFolderForm(true);
  }, []);

  const folderMap = useMemo(
    () => new Map(folders.map((f) => [f.folder_id, f])),
    [folders],
  );
  const processMap = useMemo(
    () => new Map(processes.map((p) => [p.process_id, p])),
    [processes],
  );

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
      const children: ExplorerNode[] = (
        processesByFolder[f.folder_id] ?? []
      ).map((p) => ({
        id: p.process_id,
        label: p.name,
        icon: <Cpu size={16} />,
        suffix: (
          <span className={styles.sessionIndicator}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                display: "inline-block",
                background: p.enabled
                  ? "var(--color-success)"
                  : "var(--color-text-muted)",
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
            <span
              onClick={(e) => e.stopPropagation()}
              className={styles.newChatWrap}
            >
              <ButtonPlus
                onClick={() => {
                  setProcessFormFolderId(f.folder_id);
                  setShowProcessForm(true);
                }}
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

    const rootProcesses: ExplorerNode[] = (
      processesByFolder["__root__"] ?? []
    ).map((p) => ({
      id: p.process_id,
      label: p.name,
      icon: <Cpu size={16} />,
      suffix: (
        <span className={styles.sessionIndicator}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              display: "inline-block",
              background: p.enabled
                ? "var(--color-success)"
                : "var(--color-text-muted)",
            }}
          />
        </span>
      ),
      metadata: { type: "process", folderId: null },
    }));

    return [...folderNodes, ...rootProcesses];
  }, [folders, processesByFolder]);

  const filteredExplorerData = useMemo(
    () => filterTree(explorerData, searchQuery),
    [explorerData, searchQuery],
  );
  const defaultExpandedIds = useMemo(
    () =>
      explorerData
        .filter((n) => n.children && n.children.length > 0)
        .map((n) => n.id),
    [explorerData],
  );
  const lastStoredId = useMemo(
    () => localStorage.getItem(LAST_PROCESS_ID_KEY),
    [],
  );
  const activeId = pendingSelectId ?? processId ?? lastStoredId;
  const explorerKey = useMemo(
    () =>
      folders.map((f) => f.folder_id).join() +
      ":" +
      processes.length +
      ":" +
      (pendingSelectId ?? ""),
    [folders, processes.length, pendingSelectId],
  );
  const defaultSelectedIds = useMemo(
    () => (activeId ? [activeId] : []),
    [activeId],
  );

  const handleSelect = useCallback(
    (ids: Iterable<string>) => {
      const id = getLastSelectedId(ids);
      if (!id) return;
      if (processMap.has(id)) {
        navigate(`/process/${id}`);
      }
    },
    [processMap, navigate],
  );

  const handleDrop = useCallback(
    async (draggedId: string, targetId: string, _position: DropPosition) => {
      const draggedProcess = processMap.get(draggedId);
      if (!draggedProcess) return;

      let newFolderId: string | null;
      if (folderMap.has(targetId)) {
        newFolderId = targetId;
      } else {
        const targetProcess = processMap.get(targetId);
        if (!targetProcess) return;
        newFolderId = targetProcess.folder_id;
      }

      if (newFolderId === draggedProcess.folder_id) return;

      const previous = draggedProcess;
      updateProcess({ ...draggedProcess, folder_id: newFolderId });
      try {
        await processApi.updateProcess(draggedProcess.process_id, {
          folder_id: newFolderId,
        });
      } catch {
        updateProcess(previous);
      }
    },
    [processMap, folderMap, updateProcess],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [folderMap, processMap],
  );

  const handleCtxMenuAction = useCallback(
    async (id: string) => {
      if (!ctxMenu) return;

      if (id === "add-process" && ctxMenu.folderId) {
        setProcessFormFolderId(ctxMenu.folderId);
        setShowProcessForm(true);
      }

      if (id === "rename-folder" && ctxMenu.folderId) {
        const folder = folderMap.get(ctxMenu.folderId);
        if (!folder) return;
        setRenameTarget({
          id: folder.folder_id,
          name: folder.name,
          kind: "folder",
        });
      }

      if (id === "delete-folder" && ctxMenu.folderId) {
        const folder = folderMap.get(ctxMenu.folderId);
        if (!folder) return;
        if (
          window.confirm(
            `Delete folder "${folder.name}"? Processes inside will be moved to the root.`,
          )
        ) {
          try {
            await processApi.deleteFolder(folder.folder_id);
            removeFolder(folder.folder_id);
          } catch {
            /* ignore */
          }
        }
      }

      if (id === "rename-process" && ctxMenu.processId) {
        const proc = processMap.get(ctxMenu.processId);
        if (!proc) return;
        setRenameTarget({
          id: proc.process_id,
          name: proc.name,
          kind: "process",
        });
      }

      if (id === "delete-process" && ctxMenu.processId) {
        const proc = processMap.get(ctxMenu.processId);
        if (!proc) return;
        if (window.confirm(`Delete process "${proc.name}"?`)) {
          try {
            await processApi.deleteProcess(proc.process_id);
            removeProcess(proc.process_id);
            if (
              localStorage.getItem(LAST_PROCESS_ID_KEY) === proc.process_id
            ) {
              localStorage.removeItem(LAST_PROCESS_ID_KEY);
            }
            if (processId === proc.process_id) navigate("/process");
          } catch {
            /* ignore */
          }
        }
      }

      setCtxMenu(null);
    },
    [
      ctxMenu,
      folderMap,
      processMap,
      removeFolder,
      removeProcess,
      navigate,
      processId,
    ],
  );

  const handleRenameCommit = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      try {
        if (renameTarget.kind === "folder") {
          const updated = await processApi.updateFolder(renameTarget.id, {
            name: newName,
          });
          updateFolder(updated);
        } else {
          const updated = await processApi.updateProcess(renameTarget.id, {
            name: newName,
          });
          updateProcess(updated);
        }
      } catch {
        /* ignore */
      }
      setRenameTarget(null);
    },
    [renameTarget, updateFolder, updateProcess],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "F2") return;
      const focused = (e.target as HTMLElement).closest("button[id]");
      if (!focused) return;
      const folder = folderMap.get(focused.id);
      if (folder) {
        e.preventDefault();
        setRenameTarget({
          id: folder.folder_id,
          name: folder.name,
          kind: "folder",
        });
        return;
      }
      const proc = processMap.get(focused.id);
      if (proc) {
        e.preventDefault();
        setRenameTarget({
          id: proc.process_id,
          name: proc.name,
          kind: "process",
        });
      }
    },
    [folderMap, processMap],
  );

  return {
    processes,
    folders,
    loading,
    showProcessForm,
    setShowProcessForm,
    showFolderForm,
    setShowFolderForm,
    processFormFolderId,
    addMenuAnchor,
    ctxMenu,
    ctxMenuRef,
    addMenuRef,
    renameTarget,
    setRenameTarget,
    pendingSelectId,
    setPendingSelectId,
    filteredExplorerData,
    defaultExpandedIds,
    defaultSelectedIds,
    explorerKey,
    handleSelect,
    handleDrop,
    handleContextMenu,
    handleCtxMenuAction,
    handleRenameCommit,
    handleKeyDown,
    handleAddMenuAction,
  };
}
