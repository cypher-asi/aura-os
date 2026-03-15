import { useEffect, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useOrg } from "../context/OrgContext";
import { clearLastAgentIf } from "../utils/storage";
import type { Project, AgentInstance } from "../types";
import { ButtonPlus, Explorer, Menu } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { Bot, Pencil, Trash2, Loader2 } from "lucide-react";
import { NewProjectModal } from "./NewProjectModal";
import { DeleteProjectModal, DeleteAgentInstanceModal } from "./ProjectModals";
import { AgentSelectorModal } from "./AgentSelectorModal";
import { useEventContext } from "../context/EventContext";
import styles from "./ProjectList.module.css";


/**
 * Self-contained inline rename input that overlays the label of a tree node.
 * All keystroke state is local so typing never re-renders the parent list.
 */
function InlineRenameInput({
  target,
  onSave,
  onCancel,
}: {
  target: Project;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const saved = useRef(false);

  const labelRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const row = document.getElementById(target.project_id);
    const label = row?.querySelector<HTMLElement>("[class*='label']");
    if (label) {
      labelRef.current = label;
      setRect(label.getBoundingClientRect());
      label.style.visibility = "hidden";
    }
    return () => {
      if (labelRef.current) labelRef.current.style.visibility = "";
    };
  }, [target.project_id]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [rect]);

  const commit = useCallback(() => {
    if (saved.current) return;
    const trimmed = value.trim();
    if (trimmed && trimmed !== target.name) {
      saved.current = true;
      onSave(trimmed);
    } else {
      onCancel();
    }
  }, [value, target.name, onSave, onCancel]);

  if (!rect) return null;

  return createPortal(
    <input
      ref={inputRef}
      className={styles.inlineRenameInput}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
    />,
    document.body,
  );
}

const projectMenuItems: MenuItem[] = [
  { id: "add-agent", label: "Add Agent", icon: <Bot size={14} /> },
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
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

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentsByProject, setAgentsByProject] = useState<Record<string, AgentInstance[]>>({});
  const { projectId, agentInstanceId } = useParams();
  const navigate = useNavigate();
  const sidekick = useSidekick();
  const { activeOrg } = useOrg();

  const { subscribe } = useEventContext();
  const [automatingProjectId, setAutomatingProjectId] = useState<string | null>(null);
  const [automatingAgentInstanceId, setAutomatingAgentInstanceId] = useState<string | null>(null);
  const agentInstanceIdRef = useRef(agentInstanceId);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<AgentInstance | null>(null);
  const [deleteAgentLoading, setDeleteAgentLoading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [agentSelectorProjectId, setAgentSelectorProjectId] = useState<string | null>(null);

  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const fetchProjects = useCallback(() => {
    api.listProjects(activeOrg?.org_id).then(setProjects).catch(console.error);
  }, [activeOrg?.org_id]);

  const fetchAgentInstances = useCallback((pid: string) => {
    api.listAgentInstances(pid).then((agents) => {
      setAgentsByProject((prev) => ({ ...prev, [pid]: agents }));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (prevProjectIdRef.current && !projectId) {
      fetchProjects();
    }
    prevProjectIdRef.current = projectId;
  }, [projectId, fetchProjects]);

  useEffect(() => {
    if (!projectId) return;
    if (!(projectId in agentsByProject)) {
      fetchAgentInstances(projectId);
      return;
    }
    if (agentInstanceId) {
      const cached = agentsByProject[projectId] ?? [];
      const found = cached.some((s) => s.agent_instance_id === agentInstanceId);
      if (!found) {
        fetchAgentInstances(projectId);
      }
    }
  }, [projectId, agentInstanceId]);

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
  }, [sidekick]);

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
    if (projectId && !agentInstanceId) {
      const agents = agentsByProject[projectId];
      if (agents && agents.length > 0) {
        navigate(`/projects/${projectId}/agents/${agents[0].agent_instance_id}`, { replace: true });
      }
    }
  }, [projectId, agentInstanceId, agentsByProject, navigate]);

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
      projects.map((p) => ({
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
        children:
          agentsByProject[p.project_id] !== undefined
            ? agentsByProject[p.project_id].map((s) => {
                const isAutomating = automatingProjectId === p.project_id && automatingAgentInstanceId === s.agent_instance_id;
                return {
                  id: s.agent_instance_id,
                  label: s.name,
                  icon: s.icon
                    ? <img src={s.icon} alt="" className={styles.agentAvatar} />
                    : <Bot size={16} />,
                  suffix: isAutomating
                    ? <span className={styles.sessionIndicator}><Loader2 size={10} className={styles.automationSpinner} /></span>
                    : streamingAgentInstanceId === s.agent_instance_id
                      ? <span className={styles.sessionIndicator}><span className={styles.streamingDot} /></span>
                      : undefined,
                  metadata: { type: "agent", projectId: p.project_id },
                };
              })
            : [{ id: `_load_${p.project_id}`, label: "Loading...", disabled: true }],
      })),
    [projects, agentsByProject, streamingAgentInstanceId, automatingProjectId, automatingAgentInstanceId],
  );

  const defaultExpandedIds = useMemo(
    () => (projectId ? [projectId] : []),
    [projectId],
  );

  const defaultSelectedIds = useMemo(() => {
    if (agentInstanceId) return [agentInstanceId];
    if (projectId) return [projectId];
    return [];
  }, [projectId, agentInstanceId]);

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (!id) return;
      if (projectMap.has(id)) {
        if (id !== projectId) sidekick.closePreview();
        const agents = agentsByProject[id];
        if (agents && agents.length > 0) {
          navigate(`/projects/${id}/agents/${agents[0].agent_instance_id}`);
        } else {
          navigate(`/projects/${id}`);
        }
      } else if (agentMeta.has(id)) {
        const { projectId: pid } = agentMeta.get(id)!;
        if (pid !== projectId) sidekick.closePreview();
        navigate(`/projects/${pid}/agents/${id}`);
      }
    },
    [projectMap, agentMeta, agentsByProject, navigate, projectId, sidekick],
  );

  const handleExpand = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (expanded && projectMap.has(nodeId) && !(nodeId in agentsByProject)) {
        fetchAgentInstances(nodeId);
      }
    },
    [projectMap, agentsByProject, fetchAgentInstances],
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

  const handleAddAgent = useCallback(
    (pid: string) => setAgentSelectorProjectId(pid),
    [],
  );

  const handleAgentCreated = useCallback(
    (instance: AgentInstance) => {
      const pid = instance.project_id;
      fetchAgentInstances(pid);
      navigate(`/projects/${pid}/agents/${instance.agent_instance_id}`);
    },
    [fetchAgentInstances, navigate],
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
        fetchProjects();
      } catch (err) {
        console.error("Failed to rename project", err);
      } finally {
        setRenameTarget(null);
      }
    },
    [renameTarget, fetchProjects],
  );

  const handleNewProjectClose = useCallback(() => setShowNewProject(false), []);

  const handleNewProjectCreated = useCallback(
    async (project: Project) => {
      setShowNewProject(false);
      sidekick.closePreview();
      setProjects((prev) => [...prev, project]);
      navigate(`/projects/${project.project_id}`);
    },
    [navigate, sidekick],
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteProject(deleteTarget.project_id);
      clearLastAgentIf({ projectId: deleteTarget.project_id });
      if (projectId === deleteTarget.project_id) {
        navigate("/");
      }
      setDeleteTarget(null);
      fetchProjects();
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

    const prevAgents = agentsByProject[pid];
    setAgentsByProject((prev) => ({
      ...prev,
      [pid]: (prev[pid] ?? []).filter((s) => s.agent_instance_id !== aid),
    }));

    try {
      await api.deleteAgentInstance(pid, aid);
      clearLastAgentIf({ agentInstanceId: aid });
      if (agentInstanceId === aid) {
        const remaining = (prevAgents ?? []).filter(s => s.agent_instance_id !== aid);
        if (remaining.length > 0) {
          navigate(`/projects/${pid}/agents/${remaining[remaining.length - 1].agent_instance_id}`);
        } else {
          navigate(`/projects/${pid}`);
        }
      }
      setDeleteAgentTarget(null);
      fetchAgentInstances(pid);
    } catch (err) {
      console.error("Failed to delete agent instance", err);
      if (prevAgents) {
        setAgentsByProject((prev) => ({ ...prev, [pid]: prevAgents }));
      }
    } finally {
      setDeleteAgentLoading(false);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.explorerWrap} onContextMenu={handleContextMenu} onKeyDown={handleKeyDown}>
        <div className={styles.addButton}>
          <ButtonPlus onClick={() => setShowNewProject(true)} size="sm" title="New Project" />
        </div>
        <Explorer
          data={explorerData}
          searchable
          searchPlaceholder="Search Agents..."
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

      <DeleteProjectModal
        target={deleteTarget}
        loading={deleteLoading}
        onClose={() => setDeleteTarget(null)}
        onDelete={handleDelete}
      />

      <DeleteAgentInstanceModal
        target={deleteAgentTarget}
        loading={deleteAgentLoading}
        onClose={() => setDeleteAgentTarget(null)}
        onDelete={handleDeleteAgent}
      />

      <NewProjectModal
        isOpen={showNewProject}
        onClose={handleNewProjectClose}
        onCreated={handleNewProjectCreated}
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
