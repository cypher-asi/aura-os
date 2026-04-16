import { useCallback, type KeyboardEventHandler, type MouseEventHandler } from "react";
import { processApi } from "../../../../api/process";
import { api } from "../../../../api/client";
import { LAST_PROCESS_ID_KEY, useProcessStore } from "../../stores/process-store";
import type { Project } from "../../../../types";
import { getApiErrorDetails, getApiErrorMessage } from "../../../../utils/api-errors";
import type { CtxMenuState, ProcessRecord, ProjectRecord, RenameTargetExt } from "./process-list-types";

export function useProcessContextMenu(
  projectMap: Map<string, ProjectRecord>,
  processMap: Map<string, ProcessRecord>,
  setCtxMenu: (value: CtxMenuState | null) => void,
): MouseEventHandler<HTMLDivElement> {
  return useCallback((event) => {
    const target = (event.target as HTMLElement).closest("button[id]");
    if (!target) return;
    if (projectMap.has(target.id)) {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, projectId: target.id });
      return;
    }
    if (processMap.has(target.id)) {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, processId: target.id });
    }
  }, [processMap, projectMap, setCtxMenu]);
}

export function useProcessKeyDown(
  projectMap: Map<string, ProjectRecord>,
  processMap: Map<string, ProcessRecord>,
  setRenameTarget: (value: RenameTargetExt | null) => void,
): KeyboardEventHandler<HTMLDivElement> {
  return useCallback((event) => {
    if (event.key !== "F2") return;
    const focused = (event.target as HTMLElement).closest("button[id]");
    if (!focused) return;

    const project = projectMap.get(focused.id);
    if (project) {
      event.preventDefault();
      setRenameTarget({ id: project.project_id, name: project.name, kind: "project" });
      return;
    }

    const process = processMap.get(focused.id);
    if (!process) return;
    event.preventDefault();
    setRenameTarget({ id: process.process_id, name: process.name, kind: "process" });
  }, [processMap, projectMap, setRenameTarget]);
}

export function useProcessRenameCommit(
  refreshProjects: () => Promise<unknown>,
  renameTarget: RenameTargetExt | null,
  setRenameTarget: (value: RenameTargetExt | null) => void,
  updateProcess: ReturnType<typeof useProcessStore.getState>["updateProcess"],
): (newName: string) => Promise<void> {
  return useCallback(async (newName: string) => {
    if (!renameTarget) return;
    try {
      if (renameTarget.kind === "project") {
        await api.updateProject(renameTarget.id, { name: newName });
        await refreshProjects();
      } else {
        const updated = await processApi.updateProcess(renameTarget.id, { name: newName });
        updateProcess(updated);
      }
    } catch {
      // ignore
    }
    setRenameTarget(null);
  }, [refreshProjects, renameTarget, setRenameTarget, updateProcess]);
}

export function useDeleteProjectHandler(
  deleteProjectTarget: Project | null,
  refreshProjects: () => Promise<unknown>,
  setDeleteProjectError: (value: string | null) => void,
  setDeleteProjectLoading: (value: boolean) => void,
  setDeleteProjectTarget: (value: Project | null) => void,
): () => Promise<void> {
  return useCallback(async () => {
    if (!deleteProjectTarget) return;
    setDeleteProjectLoading(true);
    setDeleteProjectError(null);
    try {
      await api.deleteProject(deleteProjectTarget.project_id);
      setDeleteProjectTarget(null);
      await refreshProjects();
    } catch (error) {
      const message = getApiErrorMessage(error);
      const details = getApiErrorDetails(error);
      setDeleteProjectError(details ? `${message} ${details}` : message);
    } finally {
      setDeleteProjectLoading(false);
    }
  }, [
    deleteProjectTarget,
    refreshProjects,
    setDeleteProjectError,
    setDeleteProjectLoading,
    setDeleteProjectTarget,
  ]);
}

function useProcessAddMenuAction(params: {
  setAddMenuAnchor: (value: { x: number; y: number } | null) => void;
  setProcessFormProjectId: (value: string | null) => void;
  setShowProcessForm: (value: boolean) => void;
}): (id: string) => void {
  return useCallback((id: string) => {
    params.setAddMenuAnchor(null);
    if (id !== "new-process") return;
    params.setProcessFormProjectId(null);
    params.setShowProcessForm(true);
  }, [params]);
}

function useDeleteProcessAction(params: {
  navigate: (path: string) => void;
  processId: string | undefined;
  removeProcess: ReturnType<typeof useProcessStore.getState>["removeProcess"];
}): (process: ProcessRecord) => Promise<void> {
  return useCallback(async (process: ProcessRecord) => {
    if (!window.confirm(`Delete process "${process.name}"?`)) return;
    try {
      await processApi.deleteProcess(process.process_id);
      params.removeProcess(process.process_id);
      if (localStorage.getItem(LAST_PROCESS_ID_KEY) === process.process_id) {
        localStorage.removeItem(LAST_PROCESS_ID_KEY);
      }
      if (params.processId === process.process_id) {
        params.navigate("/process");
      }
    } catch {
      // ignore
    }
  }, [params]);
}

function useProcessContextMenuAction(params: {
  ctxMenu: CtxMenuState | null;
  deleteProcess: (process: ProcessRecord) => Promise<void>;
  navigate: (path: string) => void;
  processId: string | undefined;
  processMap: Map<string, ProcessRecord>;
  projectMap: Map<string, ProjectRecord>;
  removeProcess: ReturnType<typeof useProcessStore.getState>["removeProcess"];
  setAddMenuAnchor: (value: { x: number; y: number } | null) => void;
  setCtxMenu: (value: CtxMenuState | null) => void;
  setDeleteProjectTarget: (value: Project | null) => void;
  setProcessFormProjectId: (value: string | null) => void;
  setRenameTarget: (value: RenameTargetExt | null) => void;
  setShowProcessForm: (value: boolean) => void;
}): (id: string) => Promise<void> {
  return useCallback(async (id: string) => {
    if (!params.ctxMenu) return;
    if (id === "add-process" && params.ctxMenu.projectId) {
      params.setProcessFormProjectId(params.ctxMenu.projectId);
      params.setShowProcessForm(true);
    }
    if (id === "rename-project" && params.ctxMenu.projectId) {
      const project = params.projectMap.get(params.ctxMenu.projectId);
      if (project) {
        params.setRenameTarget({
          id: project.project_id,
          name: project.name,
          kind: "project",
        });
      }
    }
    if (id === "delete-project" && params.ctxMenu.projectId) {
      const project = params.projectMap.get(params.ctxMenu.projectId);
      if (project) params.setDeleteProjectTarget(project);
    }
    if (id === "rename-process" && params.ctxMenu.processId) {
      const process = params.processMap.get(params.ctxMenu.processId);
      if (process) {
        params.setRenameTarget({
          id: process.process_id,
          name: process.name,
          kind: "process",
        });
      }
    }
    if (id === "delete-process" && params.ctxMenu.processId) {
      const process = params.processMap.get(params.ctxMenu.processId);
      if (process) await params.deleteProcess(process);
    }
    params.setCtxMenu(null);
  }, [params]);
}

export function useProcessMenuActions(params: {
  ctxMenu: CtxMenuState | null;
  navigate: (path: string) => void;
  processId: string | undefined;
  processMap: Map<string, ProcessRecord>;
  projectMap: Map<string, ProjectRecord>;
  removeProcess: ReturnType<typeof useProcessStore.getState>["removeProcess"];
  setAddMenuAnchor: (value: { x: number; y: number } | null) => void;
  setCtxMenu: (value: CtxMenuState | null) => void;
  setDeleteProjectTarget: (value: Project | null) => void;
  setProcessFormProjectId: (value: string | null) => void;
  setRenameTarget: (value: RenameTargetExt | null) => void;
  setShowProcessForm: (value: boolean) => void;
}): {
  handleAddMenuAction: (id: string) => void;
  handleCtxMenuAction: (id: string) => Promise<void>;
} {
  const deleteProcess = useDeleteProcessAction({
    navigate: params.navigate,
    processId: params.processId,
    removeProcess: params.removeProcess,
  });
  const handleAddMenuAction = useProcessAddMenuAction(params);
  const handleCtxMenuAction = useProcessContextMenuAction({
    ...params,
    deleteProcess,
  });

  return { handleAddMenuAction, handleCtxMenuAction };
}
