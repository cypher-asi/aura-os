import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, ApiClientError } from "../api/client";
import { clearLastAgentIf } from "../utils/storage";
import { useProjectsList } from "../apps/projects/useProjectsList";
import type { Project, AgentInstance } from "../types";

interface ContextMenuState {
  x: number;
  y: number;
  project?: Project;
  agent?: AgentInstance;
}

export function useProjectListActions() {
  const { projectId, agentInstanceId } = useParams();
  const navigate = useNavigate();
  const {
    agentsByProject,
    setAgentsByProject,
    refreshProjects,
    refreshProjectAgents,
    setProjects,
  } = useProjectsList();

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<AgentInstance | null>(null);
  const [deleteAgentLoading, setDeleteAgentLoading] = useState(false);
  const [deleteAgentError, setDeleteAgentError] = useState<string | null>(null);
  const [agentSelectorProjectId, setAgentSelectorProjectId] = useState<string | null>(null);

  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleAddAgent = useCallback(
    (pid: string) => setAgentSelectorProjectId(pid),
    [],
  );

  const handleMenuAction = useCallback((actionId: string) => {
    if (!ctxMenu) return;
    const target = ctxMenu.project;
    const agentTarget = ctxMenu.agent;
    setCtxMenu(null);

    if (actionId === "add-agent" && target) {
      handleAddAgent(target.project_id);
    } else if (actionId === "rename" && target) {
      setRenameTarget(target);
    } else if (actionId === "settings" && target) {
      setSettingsTarget(target);
    } else if (actionId === "delete" && target) {
      setDeleteTarget(target);
    } else if (actionId === "delete-agent" && agentTarget) {
      setDeleteAgentTarget(agentTarget);
    }
  }, [ctxMenu, handleAddAgent]);

  const handleRename = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      try {
        await api.updateProject(renameTarget.project_id, { name: newName });
        await refreshProjects();
      } catch (err) {
        console.error("Failed to rename project", err);
      } finally {
        setRenameTarget(null);
      }
    },
    [refreshProjects, renameTarget],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteProject(deleteTarget.project_id);
      clearLastAgentIf({ projectId: deleteTarget.project_id });
      if (projectId === deleteTarget.project_id) {
        navigate("/projects");
      }
      setDeleteTarget(null);
      await refreshProjects();
    } catch (err) {
      console.error("Failed to delete project", err);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, navigate, projectId, refreshProjects]);

  const handleDeleteAgent = useCallback(async () => {
    if (!deleteAgentTarget) return;
    const { project_id: pid, agent_instance_id: aid } = deleteAgentTarget;
    setDeleteAgentLoading(true);
    setDeleteAgentError(null);

    const prevAgents = agentsByProject[pid];
    setAgentsByProject((prev) => ({
      ...prev,
      [pid]: (prev[pid] ?? []).filter((s) => s.agent_instance_id !== aid),
    }));

    try {
      await api.deleteAgentInstance(pid, aid);
      clearLastAgentIf({ agentInstanceId: aid });
      if (agentInstanceId === aid) {
        const remaining = (prevAgents ?? []).filter((s) => s.agent_instance_id !== aid);
        if (remaining.length > 0) {
          navigate(`/projects/${pid}/agents/${remaining[remaining.length - 1].agent_instance_id}`);
        } else {
          navigate(`/projects/${pid}`);
        }
      }
      setDeleteAgentTarget(null);
      void refreshProjectAgents(pid);
    } catch (err) {
      console.error("Failed to delete agent instance", err);
      const message =
        err instanceof ApiClientError
          ? err.body.error
          : err instanceof Error
            ? err.message
            : "Failed to remove agent.";
      setDeleteAgentError(message);
      if (prevAgents) {
        setAgentsByProject((prev) => ({ ...prev, [pid]: prevAgents }));
      }
    } finally {
      setDeleteAgentLoading(false);
    }
  }, [agentInstanceId, agentsByProject, deleteAgentTarget, navigate, refreshProjectAgents, setAgentsByProject]);

  const handleAgentCreated = useCallback(
    (instance: AgentInstance) => {
      const pid = instance.project_id;
      void refreshProjectAgents(pid);
      navigate(`/projects/${pid}/agents/${instance.agent_instance_id}`);
    },
    [navigate, refreshProjectAgents],
  );

  const handleProjectSaved = useCallback(
    (project: Project) => {
      setProjects((prev) => prev.map((existing) => (
        existing.project_id === project.project_id ? project : existing
      )));
      setSettingsTarget(null);
    },
    [setProjects],
  );

  return {
    ctxMenu, setCtxMenu, ctxMenuRef,
    renameTarget, setRenameTarget,
    settingsTarget, setSettingsTarget,
    deleteTarget, setDeleteTarget, deleteLoading,
    deleteAgentTarget, setDeleteAgentTarget, deleteAgentLoading, deleteAgentError, setDeleteAgentError,
    agentSelectorProjectId, setAgentSelectorProjectId,
    handleAddAgent,
    handleMenuAction,
    handleRename,
    handleDelete,
    handleDeleteAgent,
    handleAgentCreated,
    handleProjectSaved,
  };
}
