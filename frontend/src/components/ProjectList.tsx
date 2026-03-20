import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { useSidekick } from "../context/SidekickContext";
import type { AgentInstance } from "../types";
import { ButtonPlus, Explorer, Menu, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { Bot, FolderGit2, Gauge, Loader2, Pencil, Settings, Trash2 } from "lucide-react";
import { InlineRenameInput } from "./InlineRenameInput";
import { DeleteProjectModal, DeleteAgentInstanceModal, ProjectSettingsModal } from "./ProjectModals";
import { AgentSelectorModal } from "./AgentSelectorModal";
import { useSidebarSearch } from "../context/SidebarSearchContext";
import { useLoopStatus } from "../hooks/use-loop-status";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useProjectListActions } from "../hooks/use-project-list-actions";
import {
  getMobileProjectDestination,
  projectRootPath,
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
  } = useProjectsList();

  const { query: searchQuery, setAction } = useSidebarSearch();
  const { isMobileLayout } = useAuraCapabilities();
  const { automatingProjectId, automatingAgentInstanceId } = useLoopStatus(agentInstanceId);

  const actions = useProjectListActions();
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

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
                  onClick={() => actions.handleAddAgent(p.project_id)}
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
    [projects, agentsByProject, streamingAgentInstanceId, automatingProjectId, automatingAgentInstanceId, failedIcons, actions.handleAddAgent],
  );

  const filteredExplorerData = useMemo(
    () => filterTree(explorerData, searchQuery),
    [explorerData, searchQuery],
  );
  const defaultExpandedIds = useMemo(
    () => (isMobileLayout
      ? (projectId ? [projectId] : [])
      : projectId
        ? [projectId]
        : []),
    [isMobileLayout, projectId],
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
            navigate(projectRootPath(id));
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
        actions.setRenameTarget(proj);
      }
    },
    [projectMap, actions],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("button[id]");
      if (!target) return;
      const nodeId = target.id;

      const proj = projectMap.get(nodeId);
      if (proj) {
        e.preventDefault();
        actions.setCtxMenu({ x: e.clientX, y: e.clientY, project: proj });
        return;
      }

      const meta = agentMeta.get(nodeId);
      if (meta) {
        e.preventDefault();
        actions.setCtxMenu({ x: e.clientX, y: e.clientY, agent: meta.agent });
      }
    },
    [projectMap, agentMeta, actions],
  );

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

      {actions.ctxMenu &&
        createPortal(
          <div
            ref={actions.ctxMenuRef}
            className={styles.contextMenuOverlay}
            style={{ left: actions.ctxMenu.x, top: actions.ctxMenu.y }}
          >
            <Menu
              items={actions.ctxMenu.project ? projectMenuItems : agentMenuItems}
              onChange={actions.handleMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={180}
              isOpen
            />
          </div>,
          document.body,
        )}

      {actions.renameTarget && (
        <InlineRenameInput
          target={actions.renameTarget}
          onSave={actions.handleRename}
          onCancel={() => actions.setRenameTarget(null)}
        />
      )}

      <ProjectSettingsModal
        target={actions.settingsTarget}
        onClose={() => actions.setSettingsTarget(null)}
        onSaved={actions.handleProjectSaved}
      />

      <DeleteProjectModal
        target={actions.deleteTarget}
        loading={actions.deleteLoading}
        onClose={() => actions.setDeleteTarget(null)}
        onDelete={actions.handleDelete}
      />

      <DeleteAgentInstanceModal
        target={actions.deleteAgentTarget}
        loading={actions.deleteAgentLoading}
        error={actions.deleteAgentError}
        onClose={() => {
          actions.setDeleteAgentTarget(null);
          actions.setDeleteAgentError(null);
        }}
        onDelete={actions.handleDeleteAgent}
      />

      <AgentSelectorModal
        isOpen={!!actions.agentSelectorProjectId}
        projectId={actions.agentSelectorProjectId!}
        onClose={() => actions.setAgentSelectorProjectId(null)}
        onCreated={actions.handleAgentCreated}
      />
    </div>
  );
}
