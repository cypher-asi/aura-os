import { useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ButtonPlus, Explorer, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { FolderGit2, Gauge, Loader2 } from "lucide-react";
import { Avatar } from "../Avatar";
import { useProfileStatusStore } from "../../stores/profile-status-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import {
  getMobileProjectDestination,
  projectRootPath,
  projectAgentRoute,
  projectFilesRoute,
  projectStatsRoute,
  projectWorkRoute,
} from "../../utils/mobileNavigation";
import { getLastAgent } from "../../utils/storage";
import { useProjectListData } from "./useProjectListData";
import { ProjectListModals } from "./ProjectListModals";
import { ExplorerContextMenu } from "./ExplorerContextMenu";
import { useExplorerMenus } from "./useExplorerMenus";
import { filterTree, getLastSelectedId, resolveStatus } from "./project-list-shared";

import styles from "./ProjectList.module.css";

function executionNodeId(projectId: string) {
  return `execution:${projectId}`;
}

function useProjectListEffects(data: ReturnType<typeof useProjectListData>) {
  const setAction = useAppUIStore((s) => s.setSidebarAction);
  const navigate = useNavigate();
  const {
    projectId, agentInstanceId, location, sidekick: { onAgentInstanceUpdate },
    agentsByProject, setAgentsByProject, refreshProjectAgents,
    openNewProjectModal, isMobileLayout,
  } = data;

  const recoveredAgentRef = useRef<string | null>(null);

  useEffect(() => {
    setAction("projects", <ButtonPlus onClick={openNewProjectModal} size="sm" title="New Project" />);
    return () => setAction("projects", null);
  }, [openNewProjectModal, setAction]);

  useEffect(() => {
    if (!projectId) return;
    if (!(projectId in agentsByProject)) { void refreshProjectAgents(projectId); return; }
    if (agentInstanceId) {
      const cached = agentsByProject[projectId] ?? [];
      if (!cached.some((s) => s.agent_instance_id === agentInstanceId)) {
        if (recoveredAgentRef.current !== agentInstanceId) {
          recoveredAgentRef.current = agentInstanceId;
          void refreshProjectAgents(projectId);
        }
      } else {
        recoveredAgentRef.current = null;
      }
    }
  }, [agentInstanceId, agentsByProject, projectId, refreshProjectAgents]);

  useEffect(() => {
    return onAgentInstanceUpdate((instance) => {
      setAgentsByProject((prev) => {
        const pid = instance.project_id;
        const list = prev[pid];
        if (!list) return prev;
        return { ...prev, [pid]: list.map((s) => s.agent_instance_id === instance.agent_instance_id ? { ...s, name: instance.name, status: instance.status, updated_at: instance.updated_at } : s) };
      });
    });
  }, [setAgentsByProject, onAgentInstanceUpdate]);

  useEffect(() => {
    if (!projectId || agentInstanceId || isMobileLayout) return;
    const path = location.pathname;
    if (path.endsWith("/execution") || path.endsWith("/work") || path.endsWith("/files") || path.endsWith("/stats") || path.endsWith("/agent") || path !== `/projects/${projectId}`) return;
    if (projectId in agentsByProject) {
      const agents = agentsByProject[projectId];
      if (agents && agents.length > 0) {
        const lastAid = getLastAgent(projectId);
        const target = (lastAid ? agents.find((a) => a.agent_instance_id === lastAid) : undefined) ?? agents[0];
        navigate(`/projects/${projectId}/agents/${target.agent_instance_id}`, { replace: true });
      }
    }
  }, [agentInstanceId, agentsByProject, isMobileLayout, location.pathname, navigate, projectId]);
}

function buildExplorerNode(
  p: { project_id: string; name: string },
  data: ReturnType<typeof useProjectListData>,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
): ExplorerNode {
  const { agentsByProject, automatingProjectId, automatingAgentInstanceId, isMobileLayout, actions, sidekick } = data;
  const { streamingAgentInstanceId } = sidekick;
  const projectAgents = agentsByProject[p.project_id];

  const childNodes = projectAgents !== undefined
    ? [
        ...(isMobileLayout ? [{ id: executionNodeId(p.project_id), label: "Execution", icon: <Gauge size={16} />, metadata: { type: "execution", projectId: p.project_id } }] : []),
        ...projectAgents.map((s) => {
          const isAutomating = automatingProjectId === p.project_id && automatingAgentInstanceId === s.agent_instance_id;
          const rawStatus = statusMap[s.agent_instance_id] ?? statusMap[s.agent_id] ?? s.status;
          const mt = machineTypesMap[s.agent_instance_id] ?? machineTypesMap[s.agent_id];
          const isLocal = !mt || mt === "local";
          const resolved = resolveStatus(rawStatus) ?? (isLocal ? "idle" : undefined);
          return {
            id: s.agent_instance_id, label: s.name,
            icon: (
              <Avatar
                avatarUrl={s.icon ?? undefined}
                name={s.name}
                type="agent"
                size={18}
                status={resolved}
                isLocal={isLocal}
              />
            ),
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
    id: p.project_id, label: p.name,
    suffix: (
      <span className={styles.projectSuffix}>
        <span onClick={(e) => e.stopPropagation()} className={styles.newChatWrap}>
          <ButtonPlus onClick={() => actions.handleAddAgent(p.project_id)} size="sm" title="Add Agent" />
        </span>
      </span>
    ),
    metadata: { type: "project" },
    children: childNodes,
  };
}

export function ProjectList() {
  const data = useProjectListData();
  const navigate = useNavigate();
  useProjectListEffects(data);

  const {
    projectId, agentInstanceId, location, sidekick: { closePreview },
    projects, loadingProjects, agentsByProject,
    searchQuery, isMobileLayout,
    actions, projectMap, agentMeta, refreshProjectAgents,
  } = data;

  const statusMap = useProfileStatusStore((s) => s.statuses);
  const machineTypesMap = useProfileStatusStore((s) => s.machineTypes);
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);

  useEffect(() => {
    const allAgents: { id: string; machineType: string }[] = [];
    const remoteAgents: { agent_id: string }[] = [];
    for (const agents of Object.values(agentsByProject)) {
      for (const inst of agents) {
        allAgents.push({ id: inst.agent_id, machineType: inst.machine_type });
        allAgents.push({ id: inst.agent_instance_id, machineType: inst.machine_type });
        if (inst.machine_type === "remote") remoteAgents.push({ agent_id: inst.agent_id });
      }
    }
    if (allAgents.length > 0) registerAgents(allAgents);
    if (remoteAgents.length > 0) registerRemote(remoteAgents);
  }, [agentsByProject, registerAgents, registerRemote]);

  const { automatingProjectId, automatingAgentInstanceId, sidekick: { streamingAgentInstanceId }, actions: { handleAddAgent }, isMobileLayout: isMobile } = data;
  const explorerData: ExplorerNode[] = useMemo(
    () => projects.filter((p) => p.name.trim()).map((p) => buildExplorerNode(p, data, statusMap, machineTypesMap)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- track specific fields of `data` to avoid recomputing every render
    [projects, agentsByProject, automatingProjectId, automatingAgentInstanceId, streamingAgentInstanceId, handleAddAgent, isMobile, statusMap, machineTypesMap],
  );

  const filteredExplorerData = useMemo(() => filterTree(explorerData, searchQuery), [explorerData, searchQuery]);
  const defaultExpandedIds = useMemo(
    () => explorerData
      .filter((n) => n.children && n.children.length > 0 && !n.children[0]?.id?.startsWith("_load_"))
      .map((n) => n.id),
    [explorerData],
  );
  const defaultSelectedIds = useMemo(() => {
    if (agentInstanceId) return [agentInstanceId];
    if (isMobileLayout && projectId && (location.pathname.endsWith("/execution") || location.pathname.endsWith("/work") || location.pathname.endsWith("/stats"))) {
      return [executionNodeId(projectId)];
    }
    if (projectId) return [projectId];
    return [];
  }, [agentInstanceId, isMobileLayout, location.pathname, projectId]);

  const handleSelect = useCallback((ids: Iterable<string>) => {
    const id = getLastSelectedId(ids);
    if (!id) return;
    const mobileDestination = getMobileProjectDestination(location.pathname);
    const isNested = Boolean(agentInstanceId) || location.pathname.endsWith("/execution") || location.pathname.endsWith("/work") || location.pathname.endsWith("/files") || location.pathname.endsWith("/stats");

    if (projectMap.has(id)) {
      if (id !== projectId) closePreview();
      if (isMobileLayout) {
        if (id === projectId && isNested) { navigate(projectRootPath(id)); return; }
        if (mobileDestination === "tasks") { navigate(projectWorkRoute(id)); return; }
        if (mobileDestination === "files") { navigate(projectFilesRoute(id)); return; }
        if (mobileDestination === "stats") { navigate(projectStatsRoute(id)); return; }
        navigate(projectAgentRoute(id)); return;
      }
      const agents = agentsByProject[id];
      if (agents && agents.length > 0) {
        const lastAid = getLastAgent(id);
        const target = (lastAid ? agents.find((a) => a.agent_instance_id === lastAid) : undefined) ?? agents[0];
        navigate(`/projects/${id}/agents/${target.agent_instance_id}`);
      } else if (!agents) {
        navigate(projectAgentRoute(id));
      }
    } else if (id.startsWith("execution:")) {
      const pid = id.slice("execution:".length);
      if (pid !== projectId) closePreview();
      navigate(projectWorkRoute(pid));
    } else if (agentMeta.has(id)) {
      const { projectId: pid } = agentMeta.get(id)!;
      if (pid !== projectId) closePreview();
      navigate(`/projects/${pid}/agents/${id}`);
    }
  }, [projectMap, agentMeta, agentsByProject, agentInstanceId, isMobileLayout, location.pathname, navigate, projectId, closePreview]);

  const handleExpand = useCallback((nodeId: string, expanded: boolean) => {
    const isNested = Boolean(agentInstanceId) || location.pathname.endsWith("/execution") || location.pathname.endsWith("/work") || location.pathname.endsWith("/files") || location.pathname.endsWith("/stats");
    if (!expanded && nodeId === projectId && isNested) {
      closePreview();
      if (isMobileLayout) navigate(`/projects/${nodeId}`);
      return;
    }
    if (expanded && projectMap.has(nodeId) && !(nodeId in agentsByProject)) void refreshProjectAgents(nodeId);
  }, [agentInstanceId, agentsByProject, isMobileLayout, location.pathname, navigate, projectId, projectMap, refreshProjectAgents, closePreview]);

  const { handleContextMenu, handleKeyDown } = useExplorerMenus(projectMap, agentMeta, actions);

  if (!loadingProjects && projects.length === 0) {
    return (
      <div className={styles.root}>
        <PageEmptyState icon={<FolderGit2 size={32} />} title="No projects yet" description="Open an existing project or create a linked one from the desktop app." />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.explorerWrap} onContextMenu={handleContextMenu} onKeyDown={handleKeyDown}>
        <Explorer data={filteredExplorerData} enableDragDrop={false} enableMultiSelect={false} defaultExpandedIds={defaultExpandedIds} defaultSelectedIds={defaultSelectedIds} onSelect={handleSelect} onExpand={handleExpand} />
      </div>

      <ExplorerContextMenu actions={actions} />
      <ProjectListModals actions={actions} />
    </div>
  );
}
