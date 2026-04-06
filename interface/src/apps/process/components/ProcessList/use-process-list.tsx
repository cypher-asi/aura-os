import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ButtonPlus } from "@cypher-asi/zui";
import type { ExplorerNode, DropPosition } from "@cypher-asi/zui";
import { Cpu } from "lucide-react";
import { useProcessStore, LAST_PROCESS_ID_KEY } from "../../stores/process-store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../../hooks/use-sidebar-search";
import { processApi } from "../../../../api/process";
import { api } from "../../../../api/client";
import type { Project } from "../../../../types";
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
  projectId?: string;
  processId?: string;
};

export type RenameTargetExt = InlineRenameTarget & {
  kind: "process" | "project";
};

export function useProcessListState() {
  const processes = useProcessStore((s) => s.processes);
  const projects = useProjectsListStore((s) => s.projects);
  const refreshProjects = useProjectsListStore((s) => s.refreshProjects);
  const loading = useProcessStore((s) => s.loading);
  const loadingProjects = useProjectsListStore((s) => s.loadingProjects);
  const updateProcess = useProcessStore((s) => s.updateProcess);
  const removeProcess = useProcessStore((s) => s.removeProcess);
  const navigate = useNavigate();
  const { processId } = useParams<{ processId: string }>();
  const { query: searchQuery, setAction } = useSidebarSearch();

  const [showProcessForm, setShowProcessForm] = useState(false);
  const [processFormProjectId, setProcessFormProjectId] = useState<
    string | null
  >(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTargetExt | null>(
    null,
  );
  const [deleteProjectTarget, setDeleteProjectTarget] =
    useState<Project | null>(null);
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState<string | null>(
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
        title="New Process"
      />,
    );
    return () => setAction("process", null);
  }, [setAction]);

  const handleAddMenuAction = useCallback((id: string) => {
    setAddMenuAnchor(null);
    if (id === "new-process") {
      setProcessFormProjectId(null);
      setShowProcessForm(true);
    }
  }, []);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p])),
    [projects],
  );
  const processMap = useMemo(
    () => new Map(processes.map((p) => [p.process_id, p])),
    [processes],
  );

  const processesByProject = useMemo(() => {
    const map: Record<string, typeof processes> = {};
    for (const p of processes) {
      const key = p.project_id ?? "__unassigned__";
      (map[key] ??= []).push(p);
    }
    return map;
  }, [processes]);

  const enabledDot = useCallback(
    (enabled: boolean) => (
      <span className={styles.sessionIndicator}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            display: "inline-block",
            background: enabled
              ? "var(--color-success)"
              : "var(--color-text-muted)",
          }}
        />
      </span>
    ),
    [],
  );

  // Build explorer data: projects as parents, processes as children
  const explorerData: ExplorerNode[] = useMemo(() => {
    const projectNodes: ExplorerNode[] = projects.map((proj) => {
      const children: ExplorerNode[] = (
        processesByProject[proj.project_id] ?? []
      ).map((p) => ({
        id: p.process_id,
        label: p.name,
        icon: <Cpu size={16} />,
        suffix: enabledDot(p.enabled),
        metadata: { type: "process", projectId: proj.project_id },
      }));

      return {
        id: proj.project_id,
        label: proj.name,
        suffix: (
          <span className={styles.projectSuffix}>
            <span
              onClick={(e) => e.stopPropagation()}
              className={styles.newChatWrap}
            >
              <ButtonPlus
                onClick={() => {
                  setProcessFormProjectId(proj.project_id);
                  setShowProcessForm(true);
                }}
                size="sm"
                title="Add Process"
              />
            </span>
          </span>
        ),
        metadata: { type: "project" },
        children,
      };
    });

    const orphans = processesByProject["__unassigned__"] ?? [];
    const orphanNodes: ExplorerNode[] = orphans.map((p) => ({
      id: p.process_id,
      label: p.name,
      icon: <Cpu size={16} />,
      suffix: enabledDot(p.enabled),
      metadata: { type: "process", projectId: null },
    }));

    return [...projectNodes, ...orphanNodes];
  }, [projects, processesByProject, enabledDot]);

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
      projects.map((p) => p.project_id).join() +
      ":" +
      processes.length +
      ":" +
      (pendingSelectId ?? ""),
    [projects, processes.length, pendingSelectId],
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

      let newProjectId: string | null;
      if (projectMap.has(targetId)) {
        newProjectId = targetId;
      } else {
        const targetProcess = processMap.get(targetId);
        if (!targetProcess) return;
        newProjectId = targetProcess.project_id ?? null;
      }

      if (newProjectId === (draggedProcess.project_id ?? null)) return;

      const previous = draggedProcess;
      updateProcess({ ...draggedProcess, project_id: newProjectId });
      try {
        await processApi.updateProcess(draggedProcess.process_id, {
          project_id: newProjectId,
        });
      } catch {
        updateProcess(previous);
      }
    },
    [processMap, projectMap, updateProcess],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("button[id]");
      if (!target) return;
      const nodeId = target.id;
      if (projectMap.has(nodeId)) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, projectId: nodeId });
      } else if (processMap.has(nodeId)) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, processId: nodeId });
      }
    },
    [projectMap, processMap],
  );

  const handleCtxMenuAction = useCallback(
    async (id: string) => {
      if (!ctxMenu) return;

      if (id === "add-process" && ctxMenu.projectId) {
        setProcessFormProjectId(ctxMenu.projectId);
        setShowProcessForm(true);
      }

      if (id === "rename-project" && ctxMenu.projectId) {
        const proj = projectMap.get(ctxMenu.projectId);
        if (!proj) return;
        setRenameTarget({
          id: proj.project_id,
          name: proj.name,
          kind: "project",
        });
      }

      if (id === "delete-project" && ctxMenu.projectId) {
        const proj = projectMap.get(ctxMenu.projectId);
        if (proj) setDeleteProjectTarget(proj);
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
      projectMap,
      processMap,
      removeProcess,
      navigate,
      processId,
    ],
  );

  const handleRenameCommit = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      try {
        if (renameTarget.kind === "project") {
          await api.updateProject(renameTarget.id, { name: newName });
          await refreshProjects();
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
    [renameTarget, updateProcess, refreshProjects],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "F2") return;
      const focused = (e.target as HTMLElement).closest("button[id]");
      if (!focused) return;
      const proj = projectMap.get(focused.id);
      if (proj) {
        e.preventDefault();
        setRenameTarget({
          id: proj.project_id,
          name: proj.name,
          kind: "project",
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
    [projectMap, processMap],
  );

  const handleDeleteProject = useCallback(async () => {
    if (!deleteProjectTarget) return;
    setDeleteProjectLoading(true);
    setDeleteProjectError(null);
    try {
      await api.deleteProject(deleteProjectTarget.project_id);
      setDeleteProjectTarget(null);
      await refreshProjects();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete project.";
      setDeleteProjectError(message);
    } finally {
      setDeleteProjectLoading(false);
    }
  }, [deleteProjectTarget, refreshProjects]);

  return {
    processes,
    projects,
    loading: loading || loadingProjects,
    showProcessForm,
    setShowProcessForm,
    processFormProjectId,
    addMenuAnchor,
    ctxMenu,
    ctxMenuRef,
    addMenuRef,
    renameTarget,
    setRenameTarget,
    deleteProjectTarget,
    setDeleteProjectTarget,
    deleteProjectLoading,
    deleteProjectError,
    setDeleteProjectError,
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
    handleDeleteProject,
    handleKeyDown,
    handleAddMenuAction,
  };
}
