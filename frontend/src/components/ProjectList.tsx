import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { api, ApiClientError } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { clearLastAgentIf } from "../utils/storage";
import type { Project, AgentInstance } from "../types";
import { ButtonPlus, Explorer, Menu, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { Bot, FolderGit2, Gauge, Pencil, Trash2, Loader2, Settings } from "lucide-react";
import { InlineRenameInput } from "./InlineRenameInput";
import { DeleteProjectModal, DeleteAgentInstanceModal, ProjectSettingsModal } from "./ProjectModals";
import { AgentSelectorModal } from "./AgentSelectorModal";
import { useEventContext } from "../context/EventContext";
import { useSidebarSearch } from "../context/SidebarSearchContext";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import {
  getMobileProjectDestination,
  projectAgentRoute,
  projectFilesRoute,
  projectWorkRoute,
} from "../utils/mobileNavigation";
import styles from "./ProjectList.module.css";

function filterTree(nodes: ExplorerNode[], q: string): ExplorerNode[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  return nodes.reduce<ExplorerNode[]>((acc, node) => {
    const labelMatch = node.label.toLowerCase().includes(lower);
    const filteredChildren = node.children ? filterTree(node.children, q) : [];
    if (labelMatch) {
      acc.push(node);
    } else if (filteredChildren.length > 0) {
      acc.push({ ...node, children: filteredChildren });
    }
    return acc;
  }, []);
}

const projectMenuItems: MenuItem[] = [
  { id: "add-agent", label: "Add Agent", icon: <Bot size={14} /> },
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { id: "settings", label: "Settings", icon: <Settings size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

const agentMenuItems: MenuItem[] = [
  { id: "delete-agent", label: "Delete", icon: <Trash2 size={14} /> },
];

interface ContextMenuState {
  x: number;
  y: number;
  project?: Project;
  agent?: AgentInstance;
}

function executionNodeId(projectId: string) {
  return `execution:${projectId}`;
}

export function ProjectList() {
  const { projectId, agentInstanceId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const sidekick = useSidekick();
  const {
    projects,
    loadingProjects,
    refreshProjects,
    agentsByProject,
    setAgentsByProject,
    refreshProjectAgents,
    openNewProjectModal,
    setProjects,
  } = useProjectsList();

  const { query: searchQuery, setAction } = useSidebarSearch();
  const { subscribe } = useEventContext();
  const { isMobileLayout } = useAuraCapabilities();
  const [automatingProjectId, setAutomatingProjectId] = useState<string | null>(null);
  const [automatingAgentInstanceId, setAutomatingAgentInstanceId] = useState<string | null>(null);
  const agentInstanceIdRef = useRef(agentInstanceId);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<AgentInstance | null>(null);
  const [deleteAgentLoading, setDeleteAgentLoading] = useState(false);
  const [deleteAgentError, setDeleteAgentError] = useState<string | null>(null);
  const [agentSelectorProjectId, setAgentSelectorProjectId] = useState<string | null>(null);
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAction(
      "projects",
      <ButtonPlus onClick={openNewProjectModal} size="sm" title="New Project" />,
    );
    return () => setAction("projects", null);
  }, [openNewProjectModal, setAction]);

  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (prevProjectIdRef.current && !projectId) {
      void refreshProjects();
    }
    prevProjectIdRef.current = projectId;
  }, [projectId, refreshProjects]);

  useEffect(() => {
    if (!projectId) return;
    if (!(projectId in agentsByProject)) {
      void refreshProjectAgents(projectId);
      return;
    }
    if (agentInstanceId) {
      const cached = agentsByProject[projectId] ?? [];
      const found = cached.some((s) => s.agent_instance_id === agentInstanceId);
      if (!found) {
        void refreshProjectAgents(projectId);
      }
    }
  }, [agentInstanceId, agentsByProject, projectId, refreshProjectAgents]);

  useEffect(() => {
    if (!isMobileLayout || projects.length === 0) return;

    for (const project of projects) {
      if (!(project.project_id in agentsByProject)) {
        void refreshProjectAgents(project.project_id);
      }
    }
  }, [agentsByProject, isMobileLayout, projects, refreshProjectAgents]);

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

  useEffect(() => {
    return sidekick.onAgentInstanceUpdate((instance) => {
      setAgentsByProject((prev) => {
        const pid = instance.project_id;
        const list = prev[pid];
        if (!list) return prev;
        return {
          ...prev,
          [pid]: list.map((s) =>
            s.agent_instance_id === instance.agent_instance_id ? { ...s, name: instance.name, updated_at: instance.updated_at } : s,
          ),
        };
      });
    });
  }, [setAgentsByProject, sidekick]);

  agentInstanceIdRef.current = agentInstanceId;

  useEffect(() => {
    const clearAutomation = () => {
      setAutomatingProjectId(null);
      setAutomatingAgentInstanceId(null);
    };
    const unsubs = [
      subscribe("loop_started", (e) => {
        if (e.project_id) {
          setAutomatingProjectId(e.project_id);
          setAutomatingAgentInstanceId(agentInstanceIdRef.current ?? null);
        }
      }),
      subscribe("loop_paused", clearAutomation),
      subscribe("loop_stopped", clearAutomation),
      subscribe("loop_finished", clearAutomation),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  useEffect(() => {
    if (
      !projectId ||
      agentInstanceId ||
      location.pathname.endsWith("/execution") ||
      location.pathname.endsWith("/work") ||
      location.pathname.endsWith("/files") ||
      location.pathname.endsWith("/agent") ||
      isMobileLayout ||
      location.pathname !== `/projects/${projectId}`
    ) {
      return;
    }

    if (projectId in agentsByProject) {
      const agents = agentsByProject[projectId];
      if (agents && agents.length > 0) {
        navigate(`/projects/${projectId}/agents/${agents[0].agent_instance_id}`, { replace: true });
        return;
      }

      navigate(`/projects/${projectId}/execution`, { replace: true });
    }
  }, [agentInstanceId, agentsByProject, isMobileLayout, location.pathname, navigate, projectId]);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p])),
    [projects],
  );

  const agentMeta = useMemo(() => {
    const map = new Map<string, { projectId: string; agent: AgentInstance }>();
    for (const [pid, agents] of Object.entries(agentsByProject)) {
      for (const s of agents) {
        map.set(s.agent_instance_id, { projectId: pid, agent: s });
      }
    }
    return map;
  }, [agentsByProject]);

  const { streamingAgentInstanceId } = sidekick;

  const handleAddAgent = useCallback(
    (pid: string) => setAgentSelectorProjectId(pid),
    [],
  );

  const explorerData: ExplorerNode[] = useMemo(
    () =>
      projects.filter((p) => p.name.trim()).map((p) => {
        const projectAgents = agentsByProject[p.project_id];
        const childNodes =
          projectAgents !== undefined
            ? [
                {
                  id: executionNodeId(p.project_id),
                  label: "Execution",
                  icon: <Gauge size={16} />,
                  metadata: { type: "execution", projectId: p.project_id },
                },
                ...projectAgents.map((s) => {
                  const isAutomating = automatingProjectId === p.project_id && automatingAgentInstanceId === s.agent_instance_id;
                  return {
                    id: s.agent_instance_id,
                    label: s.name,
                    icon: s.icon && !failedIcons.has(s.agent_instance_id)
                      ? (
                          <img
                            src={s.icon}
                            alt=""
                            className={styles.agentAvatar}
                            onError={() => setFailedIcons((prev) => new Set(prev).add(s.agent_instance_id))}
                          />
                        )
                      : <Bot size={16} />,
                    suffix: isAutomating
                      ? <span className={styles.sessionIndicator}><Loader2 size={10} className={styles.automationSpinner} /></span>
                      : streamingAgentInstanceId === s.agent_instance_id
                        ? <span className={styles.sessionIndicator}><span className={styles.streamingDot} /></span>
                        : undefined,
                    metadata: { type: "agent", projectId: p.project_id },
                  };
                }),
              ]
            : [{ id: `_load_${p.project_id}`, label: "Loading...", disabled: true }];

        return {
          id: p.project_id,
          label: p.name,
          suffix: (
            <span className={styles.projectSuffix}>
              <span onClick={(e) => e.stopPropagation()} className={styles.newChatWrap}>
                <ButtonPlus
                  onClick={() => handleAddAgent(p.project_id)}
                  size="sm"
                  title="Add Agent"
                />
              </span>
            </span>
          ),
          metadata: { type: "project" },
          children: childNodes,
        };
      }),
    [projects, agentsByProject, streamingAgentInstanceId, automatingProjectId, automatingAgentInstanceId, failedIcons, handleAddAgent],
  );

  const filteredExplorerData = useMemo(
    () => filterTree(explorerData, searchQuery),
    [explorerData, searchQuery],
  );
  const defaultExpandedIds = useMemo(
    () => (isMobileLayout
      ? projects.map((project) => project.project_id)
      : projectId
        ? [projectId]
        : []),
    [isMobileLayout, projectId, projects],
  );

  const defaultSelectedIds = useMemo(() => {
    if (agentInstanceId) return [agentInstanceId];
    if (projectId && (location.pathname.endsWith("/execution") || location.pathname.endsWith("/work"))) {
      return [executionNodeId(projectId)];
    }
    if (projectId) return [projectId];
    return [];
  }, [agentInstanceId, location.pathname, projectId]);

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (!id) return;
      const mobileDestination = getMobileProjectDestination(location.pathname);
      const isNestedMobileProjectView =
        Boolean(agentInstanceId) ||
        location.pathname.endsWith("/execution") ||
        location.pathname.endsWith("/work") ||
        location.pathname.endsWith("/files");

      if (projectMap.has(id)) {
        if (id !== projectId) sidekick.closePreview();
        if (isMobileLayout) {
          if (id === projectId && isNestedMobileProjectView) {
            navigate(`/projects/${id}`);
            return;
          }
          if (mobileDestination === "tasks") {
            navigate(projectWorkRoute(id));
            return;
          }
          if (mobileDestination === "files") {
            navigate(projectFilesRoute(id));
            return;
          }
          navigate(projectAgentRoute(id));
          return;
        }

        const agents = agentsByProject[id];
        if (agents && agents.length > 0) {
          navigate(`/projects/${id}/agents/${agents[0].agent_instance_id}`);
        } else {
          navigate(`/projects/${id}/execution`);
        }
      } else if (id.startsWith("execution:")) {
        const pid = id.slice("execution:".length);
        if (pid !== projectId) sidekick.closePreview();
        navigate(isMobileLayout ? projectWorkRoute(pid) : `/projects/${pid}/execution`);
      } else if (agentMeta.has(id)) {
        const { projectId: pid } = agentMeta.get(id)!;
        if (pid !== projectId) sidekick.closePreview();
        navigate(`/projects/${pid}/agents/${id}`);
      }
    },
    [projectMap, agentMeta, agentsByProject, agentInstanceId, isMobileLayout, location.pathname, navigate, projectId, sidekick],
  );

  const handleExpand = useCallback(
    (nodeId: string, expanded: boolean) => {
      const isNestedProjectRoute =
        Boolean(agentInstanceId) ||
        location.pathname.endsWith("/execution") ||
        location.pathname.endsWith("/work") ||
        location.pathname.endsWith("/files");

      if (!expanded && nodeId === projectId && isNestedProjectRoute) {
        sidekick.closePreview();
        navigate(isMobileLayout ? `/projects/${nodeId}` : "/projects");
        return;
      }

      if (expanded && projectMap.has(nodeId) && !(nodeId in agentsByProject)) {
        void refreshProjectAgents(nodeId);
      }
    },
    [agentInstanceId, agentsByProject, isMobileLayout, location.pathname, navigate, projectId, projectMap, refreshProjectAgents, sidekick],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "F2") return;
      const focused = (e.target as HTMLElement).closest("button[id]");
      if (!focused) return;
      const proj = projectMap.get(focused.id);
      if (proj) {
        e.preventDefault();
        setRenameTarget(proj);
      }
    },
    [projectMap],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("button[id]");
      if (!target) return;
      const nodeId = target.id;

      const proj = projectMap.get(nodeId);
      if (proj) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, project: proj });
        return;
      }

      const meta = agentMeta.get(nodeId);
      if (meta) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, agent: meta.agent });
      }
    },
    [projectMap, agentMeta],
  );

  const handleAgentCreated = useCallback(
    (instance: AgentInstance) => {
      const pid = instance.project_id;
      void refreshProjectAgents(pid);
      navigate(`/projects/${pid}/agents/${instance.agent_instance_id}`);
    },
    [navigate, refreshProjectAgents],
  );

  const handleMenuAction = (actionId: string) => {
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
  };

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

  const handleDelete = async () => {
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
  };

  const handleDeleteAgent = async () => {
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
  };

  if (!loadingProjects && projects.length === 0) {
    return (
      <div className={styles.root}>
        <PageEmptyState
          icon={<FolderGit2 size={32} />}
          title="No projects yet"
          description="Open an existing project from this team, or create a linked project from the desktop app."
        />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.explorerWrap} onContextMenu={handleContextMenu} onKeyDown={handleKeyDown}>
        <Explorer
          data={filteredExplorerData}
          expandOnSelect
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultExpandedIds={defaultExpandedIds}
          defaultSelectedIds={defaultSelectedIds}
          onSelect={handleSelect}
          onExpand={handleExpand}
        />
      </div>

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxMenuRef}
            className={styles.contextMenuOverlay}
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <Menu
              items={ctxMenu.project ? projectMenuItems : agentMenuItems}
              onChange={handleMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={180}
              isOpen
            />
          </div>,
          document.body,
        )}

      {renameTarget && (
        <InlineRenameInput
          target={renameTarget}
          onSave={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      <ProjectSettingsModal
        target={settingsTarget}
        onClose={() => setSettingsTarget(null)}
        onSaved={(project) => {
          setProjects((prev) => prev.map((existing) => (
            existing.project_id === project.project_id ? project : existing
          )));
          setSettingsTarget(null);
        }}
      />

      <DeleteProjectModal
        target={deleteTarget}
        loading={deleteLoading}
        onClose={() => setDeleteTarget(null)}
        onDelete={handleDelete}
      />

      <DeleteAgentInstanceModal
        target={deleteAgentTarget}
        loading={deleteAgentLoading}
        error={deleteAgentError}
        onClose={() => {
          setDeleteAgentTarget(null);
          setDeleteAgentError(null);
        }}
        onDelete={handleDeleteAgent}
      />

      <AgentSelectorModal
        isOpen={!!agentSelectorProjectId}
        projectId={agentSelectorProjectId!}
        onClose={() => setAgentSelectorProjectId(null)}
        onCreated={handleAgentCreated}
      />
    </div>
  );
}
