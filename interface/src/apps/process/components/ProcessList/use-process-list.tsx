import {
  useCallback,
  useMemo,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type RefObject,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProcessStore } from "../../stores/process-store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../../hooks/use-sidebar-search";
import type { ProjectExplorerNodeStyles } from "../../../../components/ProjectList/project-list-explorer-node";
import { filterTree } from "../../../../components/ProjectList/project-list-shared";
import { buildLeftMenuEntries, useLeftMenuExpandedGroups } from "../../../../features/left-menu";
import { buildProcessExplorerData } from "./process-list-explorer-node";
import {
  useDeleteProjectHandler,
  useProcessContextMenu,
  useProcessKeyDown,
  useProcessMenuActions,
  useProcessRenameCommit,
} from "./process-list-handlers";
import { useProcessListUiState, useProcessSidebarAction } from "./process-list-ui";
import type { ProcessRecord, ProjectRecord, RenameTargetExt } from "./process-list-types";

export type { RenameTargetExt } from "./process-list-types";

function useProcessMaps(
  processes: ProcessRecord[],
  projects: ProjectRecord[],
): {
  processMap: Map<string, ProcessRecord>;
  processesByProject: Record<string, ProcessRecord[]>;
  projectMap: Map<string, ProjectRecord>;
} {
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.project_id, project])),
    [projects],
  );
  const processMap = useMemo(
    () => new Map(processes.map((process) => [process.process_id, process])),
    [processes],
  );
  const processesByProject = useMemo(() => {
    const nextMap: Record<string, ProcessRecord[]> = {};
    for (const process of processes) {
      const projectId = process.project_id ?? "__unassigned__";
      (nextMap[projectId] ??= []).push(process);
    }
    return nextMap;
  }, [processes]);

  return { processMap, processesByProject, projectMap };
}

function useProcessStoreData(): {
  loading: boolean;
  loadingProjects: boolean;
  processId: string | undefined;
  processMap: Map<string, ProcessRecord>;
  processes: ProcessRecord[];
  processesByProject: Record<string, ProcessRecord[]>;
  projectMap: Map<string, ProjectRecord>;
  projects: ProjectRecord[];
  refreshProjects: () => Promise<unknown>;
  removeProcess: ReturnType<typeof useProcessStore.getState>["removeProcess"];
  searchQuery: string;
  updateProcess: ReturnType<typeof useProcessStore.getState>["updateProcess"];
} {
  const processes = useProcessStore((s) => s.processes);
  const loading = useProcessStore((s) => s.loading);
  const updateProcess = useProcessStore((s) => s.updateProcess);
  const removeProcess = useProcessStore((s) => s.removeProcess);
  const projects = useProjectsListStore((s) => s.projects);
  const refreshProjects = useProjectsListStore((s) => s.refreshProjects);
  const loadingProjects = useProjectsListStore((s) => s.loadingProjects);
  const { processId } = useParams<{ processId: string }>();
  const { query: searchQuery } = useSidebarSearch("process");
  const { processMap, processesByProject, projectMap } = useProcessMaps(processes, projects);

  return {
    loading,
    loadingProjects,
    processId,
    processMap,
    processes,
    processesByProject,
    projectMap,
    projects,
    refreshProjects,
    removeProcess,
    searchQuery,
    updateProcess,
  };
}

function useProcessExplorerData(
  explorerStyles: ProjectExplorerNodeStyles,
  onAddProcess: (projectId: string | null) => void,
): {
  data: ReturnType<typeof useProcessStoreData>;
  filteredExplorerData: ReturnType<typeof buildProcessExplorerData>;
  isEmptyState: boolean;
} {
  const data = useProcessStoreData();
  const explorerData = useMemo(
    () =>
      buildProcessExplorerData({
        processes: data.processes,
        projects: data.projects,
        processesByProject: data.processesByProject,
        explorerStyles,
        onAddProcess,
      }),
    [
      data.processes,
      data.processesByProject,
      data.projects,
      explorerStyles,
      onAddProcess,
    ],
  );
  const filteredExplorerData = useMemo(
    () => filterTree(explorerData, data.searchQuery),
    [data.searchQuery, explorerData],
  );

  return {
    data,
    filteredExplorerData,
    isEmptyState:
      !data.loading &&
      !data.loadingProjects &&
      data.processes.length === 0 &&
      data.projects.length === 0,
  };
}

function useProcessEntryList(
  filteredExplorerData: ReturnType<typeof buildProcessExplorerData>,
  searchQuery: string,
  selectedNodeId: string | null,
  onSelectProcess: (processId: string) => void,
): ReturnType<typeof buildLeftMenuEntries> {
  const defaultExpandedIds = useMemo(
    () =>
      filteredExplorerData
        .filter((node) => node.children && node.children.length > 0)
        .map((node) => node.id),
    [filteredExplorerData],
  );
  const { expandedIds, toggleGroup } = useLeftMenuExpandedGroups(defaultExpandedIds);

  return useMemo(
    () =>
      buildLeftMenuEntries(filteredExplorerData, {
        expandedIds: new Set(expandedIds),
        selectedNodeId,
        searchActive: searchQuery.trim().length > 0,
        groupTestIdPrefix: "project",
        itemTestIdPrefix: "node",
        onGroupActivate: toggleGroup,
        onItemSelect: onSelectProcess,
      }),
    [expandedIds, filteredExplorerData, onSelectProcess, searchQuery, selectedNodeId, toggleGroup],
  );
}

function useProcessEntries(
  explorerStyles: ProjectExplorerNodeStyles,
  onAddProcess: (projectId: string | null) => void,
  onSelectProcess: (processId: string) => void,
  pendingSelectId: string | null,
): {
  data: ReturnType<typeof useProcessStoreData>;
  entries: ReturnType<typeof buildLeftMenuEntries>;
  isEmptyState: boolean;
} {
  const explorer = useProcessExplorerData(explorerStyles, onAddProcess);
  const selectedNodeId = pendingSelectId ?? explorer.data.processId ?? null;
  const entries = useProcessEntryList(
    explorer.filteredExplorerData,
    explorer.data.searchQuery,
    selectedNodeId,
    onSelectProcess,
  );

  return { ...explorer, entries };
}

function useProcessCoreHandlers(params: {
  explorer: ReturnType<typeof useProcessEntries>;
  navigate: ReturnType<typeof useNavigate>;
  processId: string | undefined;
  ui: ReturnType<typeof useProcessListUiState>;
}): {
  handleContextMenu: MouseEventHandler<HTMLDivElement>;
  handleDeleteProject: () => Promise<void>;
  handleKeyDown: KeyboardEventHandler<HTMLDivElement>;
  handleRenameCommit: (newName: string) => Promise<void>;
} {
  return {
    handleContextMenu: useProcessContextMenu(
      params.explorer.data.projectMap,
      params.explorer.data.processMap,
      params.ui.setCtxMenu,
    ),
    handleKeyDown: useProcessKeyDown(
      params.explorer.data.projectMap,
      params.explorer.data.processMap,
      params.ui.setRenameTarget,
    ),
    handleRenameCommit: useProcessRenameCommit(
      params.explorer.data.refreshProjects,
      params.ui.renameTarget,
      params.ui.setRenameTarget,
      params.explorer.data.updateProcess,
    ),
    handleDeleteProject: useDeleteProjectHandler(
      params.ui.deleteProjectTarget,
      params.explorer.data.refreshProjects,
      params.ui.setDeleteProjectError,
      params.ui.setDeleteProjectLoading,
      params.ui.setDeleteProjectTarget,
    ),
  };
}

function useProcessInteractionHandlers(params: {
  explorer: ReturnType<typeof useProcessEntries>;
  navigate: ReturnType<typeof useNavigate>;
  processId: string | undefined;
  ui: ReturnType<typeof useProcessListUiState>;
}): {
  handleAddMenuAction: (id: string) => void;
  handleContextMenu: MouseEventHandler<HTMLDivElement>;
  handleCtxMenuAction: (id: string) => Promise<void>;
  handleDeleteProject: () => Promise<void>;
  handleKeyDown: KeyboardEventHandler<HTMLDivElement>;
  handleRenameCommit: (newName: string) => Promise<void>;
} {
  const coreHandlers = useProcessCoreHandlers(params);
  const menuHandlers = useProcessMenuActions({
    ctxMenu: params.ui.ctxMenu,
    navigate: params.navigate,
    processId: params.processId,
    processMap: params.explorer.data.processMap,
    projectMap: params.explorer.data.projectMap,
    removeProcess: params.explorer.data.removeProcess,
    setAddMenuAnchor: params.ui.setAddMenuAnchor,
    setCtxMenu: params.ui.setCtxMenu,
    setDeleteProjectTarget: params.ui.setDeleteProjectTarget,
    setProcessFormProjectId: params.ui.setProcessFormProjectId,
    setRenameTarget: params.ui.setRenameTarget,
    setShowProcessForm: params.ui.setShowProcessForm,
  });

  return { ...coreHandlers, ...menuHandlers };
}

export function useProcessListState(
  explorerStyles: ProjectExplorerNodeStyles,
): {
  addMenuAnchor: { x: number; y: number } | null;
  addMenuRef: RefObject<HTMLDivElement | null>;
  ctxMenu: ReturnType<typeof useProcessListUiState>["ctxMenu"];
  ctxMenuRef: RefObject<HTMLDivElement | null>;
  deleteProjectError: string | null;
  deleteProjectLoading: boolean;
  deleteProjectTarget: ProjectRecord | null;
  entries: ReturnType<typeof buildLeftMenuEntries>;
  handleAddMenuAction: (id: string) => void;
  handleContextMenu: MouseEventHandler<HTMLDivElement>;
  handleCtxMenuAction: (id: string) => Promise<void>;
  handleDeleteProject: () => Promise<void>;
  handleKeyDown: KeyboardEventHandler<HTMLDivElement>;
  handleRenameCommit: (newName: string) => Promise<void>;
  isEmptyState: boolean;
  processFormProjectId: string | null;
  renameTarget: RenameTargetExt | null;
  setDeleteProjectError: (value: string | null) => void;
  setDeleteProjectTarget: (value: ProjectRecord | null) => void;
  setPendingSelectId: (value: string | null) => void;
  setRenameTarget: (value: RenameTargetExt | null) => void;
  setShowProcessForm: (value: boolean) => void;
  showProcessForm: boolean;
} {
  const navigate = useNavigate();
  const { processId } = useParams<{ processId: string }>();
  const ui = useProcessListUiState();
  useProcessSidebarAction(ui.setAddMenuAnchor);

  const handleSelectProcess = useCallback((nextProcessId: string) => {
    ui.setPendingSelectId(null);
    navigate(`/process/${nextProcessId}`);
  }, [navigate, ui.setPendingSelectId]);
  const explorer = useProcessEntries(
    explorerStyles,
    (projectId) => {
      ui.setProcessFormProjectId(projectId);
      ui.setShowProcessForm(true);
    },
    handleSelectProcess,
    ui.pendingSelectId,
  );
  const handlers = useProcessInteractionHandlers({ explorer, navigate, processId, ui });

  return {
    addMenuAnchor: ui.addMenuAnchor,
    addMenuRef: ui.addMenuRef,
    ctxMenu: ui.ctxMenu,
    ctxMenuRef: ui.ctxMenuRef,
    deleteProjectError: ui.deleteProjectError,
    deleteProjectLoading: ui.deleteProjectLoading,
    deleteProjectTarget: ui.deleteProjectTarget,
    entries: explorer.entries,
    handleAddMenuAction: handlers.handleAddMenuAction,
    handleContextMenu: handlers.handleContextMenu,
    handleCtxMenuAction: handlers.handleCtxMenuAction,
    handleDeleteProject: handlers.handleDeleteProject,
    handleKeyDown: handlers.handleKeyDown,
    handleRenameCommit: handlers.handleRenameCommit,
    isEmptyState: explorer.isEmptyState,
    processFormProjectId: ui.processFormProjectId,
    renameTarget: ui.renameTarget,
    setDeleteProjectError: ui.setDeleteProjectError,
    setDeleteProjectTarget: ui.setDeleteProjectTarget,
    setPendingSelectId: ui.setPendingSelectId,
    setRenameTarget: ui.setRenameTarget,
    setShowProcessForm: ui.setShowProcessForm,
    showProcessForm: ui.showProcessForm,
  };
}
