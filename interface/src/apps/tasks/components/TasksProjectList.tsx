import { useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ButtonPlus, Explorer, Menu, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { Bot, FolderGit2, Loader2, Pencil, Settings, Trash2 } from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import { useSidebarSearch } from "../../../context/SidebarSearchContext";
import { useProjectListData } from "../../../components/ProjectList/useProjectListData";
import { ProjectListModals } from "../../../components/ProjectList/ProjectListModals";

import styles from "../../../components/ProjectList/ProjectList.module.css";

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

function getLastSelectedId(ids: Iterable<string>): string | null {
  let selectedId: string | null = null;
  for (const id of ids) {
    selectedId = id;
  }
  return selectedId;
}

function useTasksProjectListEffects(data: ReturnType<typeof useProjectListData>) {
  const { setAction } = useSidebarSearch();
  const {
    projectId, agentsByProject, setAgentsByProject, refreshProjectAgents,
    openNewProjectModal, sidekick, agentInstanceId,
  } = data;

  const recoveredAgentRef = useRef<string | null>(null);

  useEffect(() => {
    setAction("tasks", <ButtonPlus onClick={openNewProjectModal} size="sm" title="New Project" />);
    return () => setAction("tasks", null);
  }, [openNewProjectModal, setAction]);

  useEffect(() => {
    if (!projectId) return;
    if (!(projectId in agentsByProject)) {
      void refreshProjectAgents(projectId);
      return;
    }
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
    return sidekick.onAgentInstanceUpdate((instance) => {
      setAgentsByProject((prev) => {
        const pid = instance.project_id;
        const list = prev[pid];
        if (!list) return prev;
        return {
          ...prev,
          [pid]: list.map((s) =>
            s.agent_instance_id === instance.agent_instance_id
              ? { ...s, name: instance.name, status: instance.status, updated_at: instance.updated_at }
              : s,
          ),
        };
      });
    });
  }, [setAgentsByProject, sidekick]);
}

const STATUS_MAP: Record<string, string> = {
  running: "running",
  working: "running",
  idle: "idle",
  provisioning: "provisioning",
  hibernating: "hibernating",
  stopping: "stopping",
  stopped: "stopped",
  error: "error",
  blocked: "error",
};

function resolveStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return STATUS_MAP[raw.toLowerCase()] ?? raw;
}

function buildExplorerNode(
  p: { project_id: string; name: string },
  data: ReturnType<typeof useProjectListData>,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
): ExplorerNode {
  const { agentsByProject, automatingProjectId, automatingAgentInstanceId, actions, sidekick } = data;
  const { streamingAgentInstanceId } = sidekick;
  const projectAgents = agentsByProject[p.project_id];

  const childNodes = projectAgents !== undefined
    ? projectAgents.map((s) => {
        const isAutomating =
          automatingProjectId === p.project_id &&
          automatingAgentInstanceId === s.agent_instance_id;
        const rawStatus = statusMap[s.agent_instance_id] ?? statusMap[s.agent_id] ?? s.status;
        const mt = machineTypesMap[s.agent_instance_id] ?? machineTypesMap[s.agent_id];
        const isLocal = !mt || mt === "local";
        const resolved = resolveStatus(rawStatus) ?? (isLocal ? "idle" : undefined);
        return {
          id: s.agent_instance_id,
          label: s.name,
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
      })
    : [{ id: `_load_${p.project_id}`, label: "Loading...", disabled: true }];

  return {
    id: p.project_id,
    label: p.name,
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

export function TasksProjectList() {
  const data = useProjectListData();
  const navigate = useNavigate();
  useTasksProjectListEffects(data);

  const {
    projectId, agentInstanceId, sidekick,
    projects, loadingProjects, agentsByProject,
    automatingProjectId, automatingAgentInstanceId,
    searchQuery,
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
      if (!Array.isArray(agents)) continue;
      for (const inst of agents) {
        allAgents.push({ id: inst.agent_id, machineType: inst.machine_type });
        allAgents.push({ id: inst.agent_instance_id, machineType: inst.machine_type });
        if (inst.machine_type === "remote") remoteAgents.push({ agent_id: inst.agent_id });
      }
    }
    if (allAgents.length > 0) registerAgents(allAgents);
    if (remoteAgents.length > 0) registerRemote(remoteAgents);
  }, [agentsByProject, registerAgents, registerRemote]);

  const explorerData: ExplorerNode[] = useMemo(
    () => projects.filter((p) => p.name.trim()).map((p) => buildExplorerNode(p, data, statusMap, machineTypesMap)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- track specific fields of `data` to avoid recomputing every render
    [projects, agentsByProject, automatingProjectId, automatingAgentInstanceId, sidekick.streamingAgentInstanceId, actions.handleAddAgent, statusMap, machineTypesMap],
  );

  const filteredExplorerData = useMemo(() => filterTree(explorerData, searchQuery), [explorerData, searchQuery]);
  const defaultExpandedIds = useMemo(() => projects.map((p) => p.project_id), [projects]);
  const defaultSelectedIds = useMemo(() => {
    if (agentInstanceId) return [agentInstanceId];
    if (projectId) return [projectId];
    return [];
  }, [agentInstanceId, projectId]);

  const handleSelect = useCallback((ids: Iterable<string>) => {
    const id = getLastSelectedId(ids);
    if (!id) return;

    if (projectMap.has(id)) {
      if (id !== projectId) sidekick.closePreview();
      navigate(`/tasks/${id}`);
    } else if (agentMeta.has(id)) {
      const { projectId: pid } = agentMeta.get(id)!;
      if (pid !== projectId) sidekick.closePreview();
      navigate(`/tasks/${pid}/agents/${id}`);
    }
  }, [projectMap, agentMeta, navigate, projectId, sidekick]);

  const handleExpand = useCallback((nodeId: string, expanded: boolean) => {
    const isNested = Boolean(agentInstanceId);
    if (!expanded && nodeId === projectId && isNested) {
      sidekick.closePreview();
      return;
    }
    if (expanded && projectMap.has(nodeId) && !(nodeId in agentsByProject))
      void refreshProjectAgents(nodeId);
  }, [agentInstanceId, agentsByProject, projectId, projectMap, refreshProjectAgents, sidekick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "F2") return;
    const focused = (e.target as HTMLElement).closest("button[id]");
    if (!focused) return;
    const proj = projectMap.get(focused.id);
    if (proj) { e.preventDefault(); actions.setRenameTarget(proj); }
  }, [projectMap, actions]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("button[id]");
    if (!target) return;
    const nodeId = target.id;
    const proj = projectMap.get(nodeId);
    if (proj) { e.preventDefault(); actions.setCtxMenu({ x: e.clientX, y: e.clientY, project: proj }); return; }
    const meta = agentMeta.get(nodeId);
    if (meta) { e.preventDefault(); actions.setCtxMenu({ x: e.clientX, y: e.clientY, agent: meta.agent }); }
  }, [projectMap, agentMeta, actions]);

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
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultExpandedIds={defaultExpandedIds}
          defaultSelectedIds={defaultSelectedIds}
          onSelect={handleSelect}
          onExpand={handleExpand}
        />
      </div>

      {actions.ctxMenu && createPortal(
        <div ref={actions.ctxMenuRef} className={styles.contextMenuOverlay} style={{ left: actions.ctxMenu.x, top: actions.ctxMenu.y }}>
          <Menu items={actions.ctxMenu.project ? projectMenuItems : agentMenuItems} onChange={actions.handleMenuAction} background="solid" border="solid" rounded="md" width={180} isOpen />
        </div>,
        document.body,
      )}

      <ProjectListModals actions={actions} />
    </div>
  );
}
