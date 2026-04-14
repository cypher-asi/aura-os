import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, ApiClientError } from "../api/client";
import { queryClient } from "../lib/query-client";
import { mergeAgentIntoProjectAgents, projectQueryKeys } from "../queries/project-queries";
import { clearLastAgentIf } from "../utils/storage";
import { createAgentChatHandoffState } from "../utils/chat-handoff";
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<AgentInstance | null>(null);
  const [deleteAgentLoading, setDeleteAgentLoading] = useState(false);
  const [deleteAgentError, setDeleteAgentError] = useState<string | null>(null);
  const [agentSelectorProjectId, setAgentSelectorProjectId] = useState<string | null>(null);
  const [pendingCreatedAgent, setPendingCreatedAgent] = useState<AgentInstance | null>(null);
  const [creatingGeneralAgentProjectIds, setCreatingGeneralAgentProjectIds] = useState<string[]>([]);
  const [archivingAgentInstanceIds, setArchivingAgentInstanceIds] = useState<string[]>([]);

  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const ctxMenuStateRef = useRef(ctxMenu);
  ctxMenuStateRef.current = ctxMenu;
  const creatingGeneralAgentProjectIdsRef = useRef(creatingGeneralAgentProjectIds);
  creatingGeneralAgentProjectIdsRef.current = creatingGeneralAgentProjectIds;
  const archivingAgentInstanceIdsRef = useRef(archivingAgentInstanceIds);
  archivingAgentInstanceIdsRef.current = archivingAgentInstanceIds;

  useEffect(() => {
    if (!ctxMenu) return;
    const handleDocumentClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!pendingCreatedAgent) {
      return;
    }
    if (
      projectId === pendingCreatedAgent.project_id &&
      agentInstanceId === pendingCreatedAgent.agent_instance_id
    ) {
      setAgentSelectorProjectId(null);
      setPendingCreatedAgent(null);
    }
  }, [agentInstanceId, pendingCreatedAgent, projectId]);

  const handleAddAgent = useCallback(
    (pid: string) => setAgentSelectorProjectId(pid),
    [],
  );

  const handleAgentCreated = useCallback(
    (instance: AgentInstance) => {
      const pid = instance.project_id;
      setAgentsByProject((prev) => ({
        ...prev,
        [pid]: mergeAgentIntoProjectAgents(prev[pid], instance),
      }));
      queryClient.setQueryData(
        projectQueryKeys.agentInstance(pid, instance.agent_instance_id),
        instance,
      );
      setPendingCreatedAgent(instance);
      navigate(`/projects/${pid}/agents/${instance.agent_instance_id}`, {
        state: createAgentChatHandoffState(),
      });
      void refreshProjectAgents(pid);
    },
    [navigate, refreshProjectAgents, setAgentsByProject],
  );

  const handleQuickAddAgent = useCallback(async (pid: string) => {
    if (creatingGeneralAgentProjectIdsRef.current.includes(pid)) {
      return;
    }

    setCreatingGeneralAgentProjectIds((prev) => [...prev, pid]);
    try {
      const instance = await api.createGeneralAgentInstance(pid);
      handleAgentCreated(instance);
    } catch (err) {
      console.error("Failed to create general project agent", err);
    } finally {
      setCreatingGeneralAgentProjectIds((prev) => prev.filter((projectId) => projectId !== pid));
    }
  }, [handleAgentCreated]);

  const handleMenuAction = useCallback((actionId: string) => {
    const menu = ctxMenuStateRef.current;
    if (!menu) return;
    const target = menu.project;
    const agentTarget = menu.agent;
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
  }, [handleAddAgent]);

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
    setDeleteError(null);
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
      const message =
        err instanceof ApiClientError
          ? err.body.error
          : err instanceof Error
            ? err.message
            : "Failed to delete project.";
      setDeleteError(message);
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

  const handleArchiveAgent = useCallback(async (target: AgentInstance) => {
    const { project_id: pid, agent_instance_id: aid } = target;
    if (archivingAgentInstanceIdsRef.current.includes(aid)) {
      return;
    }

    const optimisticUpdatedAt = new Date().toISOString();
    const archivedAgent: AgentInstance = {
      ...target,
      status: "archived",
      updated_at: optimisticUpdatedAt,
    };
    setArchivingAgentInstanceIds((prev) => [...prev, aid]);
    setAgentsByProject((prev) => ({
      ...prev,
      [pid]: (prev[pid] ?? []).map((agent) =>
        agent.agent_instance_id === aid
          ? { ...agent, status: "archived", updated_at: optimisticUpdatedAt }
          : agent,
      ),
    }));

    queryClient.setQueryData(projectQueryKeys.agentInstance(pid, aid), archivedAgent);
    setArchivingAgentInstanceIds((prev) => prev.filter((id) => id !== aid));
  }, [setAgentsByProject]);

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
    deleteTarget, setDeleteTarget, deleteLoading, deleteError, setDeleteError,
    deleteAgentTarget, setDeleteAgentTarget, deleteAgentLoading, deleteAgentError, setDeleteAgentError,
    agentSelectorProjectId, setAgentSelectorProjectId, pendingCreatedAgent,
    creatingGeneralAgentProjectIds,
    archivingAgentInstanceIds,
    handleAddAgent,
    handleQuickAddAgent,
    handleMenuAction,
    handleRename,
    handleDelete,
    handleDeleteAgent,
    handleAgentCreated,
    handleArchiveAgent,
    handleProjectSaved,
  };
}
