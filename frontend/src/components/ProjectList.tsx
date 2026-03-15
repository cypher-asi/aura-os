import { useEffect, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useOrg } from "../context/OrgContext";
import { clearLastChatIf } from "../utils/storage";
import type { Project, ChatSession } from "../types";
import { ButtonPlus, Explorer, Menu } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { MessageSquare, Pencil, Trash2, Loader2 } from "lucide-react";
import { NewProjectModal } from "./NewProjectModal";
import { DeleteProjectModal, DeleteSessionModal } from "./ProjectModals";
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
  { id: "new-chat", label: "New Chat", icon: <MessageSquare size={14} /> },
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

const sessionMenuItems: MenuItem[] = [
  { id: "delete-session", label: "Delete", icon: <Trash2 size={14} /> },
];

interface ContextMenuState {
  x: number;
  y: number;
  project?: Project;
  session?: ChatSession;
}

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, ChatSession[]>>({});
  const { projectId, chatSessionId } = useParams();
  const navigate = useNavigate();
  const sidekick = useSidekick();
  const { activeOrg } = useOrg();

  const { subscribe } = useEventContext();
  const [automatingProjectId, setAutomatingProjectId] = useState<string | null>(null);
  const [automatingChatId, setAutomatingChatId] = useState<string | null>(null);
  const chatSessionIdRef = useRef(chatSessionId);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<ChatSession | null>(null);
  const [deleteSessionLoading, setDeleteSessionLoading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const fetchProjects = useCallback(() => {
    api.listProjects(activeOrg?.org_id).then(setProjects).catch(console.error);
  }, [activeOrg?.org_id]);

  const fetchSessions = useCallback((pid: string) => {
    api.listChatSessions(pid).then((sessions) => {
      setSessionsByProject((prev) => ({ ...prev, [pid]: sessions }));
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
    if (!(projectId in sessionsByProject)) {
      fetchSessions(projectId);
      return;
    }
    if (chatSessionId) {
      const cached = sessionsByProject[projectId] ?? [];
      const found = cached.some((s) => s.chat_session_id === chatSessionId);
      if (!found) {
        fetchSessions(projectId);
      }
    }
  }, [projectId, chatSessionId]);

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
    return sidekick.onSessionTitleUpdate((session) => {
      setSessionsByProject((prev) => {
        const pid = session.project_id;
        const list = prev[pid];
        if (!list) return prev;
        return {
          ...prev,
          [pid]: list.map((s) =>
            s.chat_session_id === session.chat_session_id ? { ...s, title: session.title, updated_at: session.updated_at } : s,
          ),
        };
      });
    });
  }, [sidekick]);

  chatSessionIdRef.current = chatSessionId;

  useEffect(() => {
    const clearAutomation = () => {
      setAutomatingProjectId(null);
      setAutomatingChatId(null);
    };
    const unsubs = [
      subscribe("loop_started", (e) => {
        if (e.project_id) {
          setAutomatingProjectId(e.project_id);
          setAutomatingChatId(chatSessionIdRef.current ?? null);
        }
      }),
      subscribe("loop_paused", clearAutomation),
      subscribe("loop_stopped", clearAutomation),
      subscribe("loop_finished", clearAutomation),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p])),
    [projects],
  );

  const sessionMeta = useMemo(() => {
    const map = new Map<string, { projectId: string; session: ChatSession }>();
    for (const [pid, sessions] of Object.entries(sessionsByProject)) {
      for (const s of sessions) {
        map.set(s.chat_session_id, { projectId: pid, session: s });
      }
    }
    return map;
  }, [sessionsByProject]);

  const { streamingSessionId } = sidekick;

  const explorerData: ExplorerNode[] = useMemo(
    () =>
      projects.map((p) => ({
        id: p.project_id,
        label: p.name,
        suffix: (
          <span className={styles.projectSuffix}>
            <span onClick={(e) => e.stopPropagation()} className={styles.newChatWrap}>
              <ButtonPlus
                onClick={() => handleNewSession(p.project_id)}
                size="sm"
                title="New Chat"
              />
            </span>
          </span>
        ),
        metadata: { type: "project" },
        children:
          sessionsByProject[p.project_id] !== undefined
            ? sessionsByProject[p.project_id].map((s) => {
                const isAutomating = automatingProjectId === p.project_id && automatingChatId === s.chat_session_id;
                return {
                  id: s.chat_session_id,
                  label: s.title,
                  suffix: isAutomating
                    ? <span className={styles.sessionIndicator}><Loader2 size={10} className={styles.automationSpinner} /></span>
                    : streamingSessionId === s.chat_session_id
                      ? <span className={styles.sessionIndicator}><span className={styles.streamingDot} /></span>
                      : undefined,
                  metadata: { type: "session", projectId: p.project_id },
                };
              })
            : [{ id: `_load_${p.project_id}`, label: "Loading...", disabled: true }],
      })),
    [projects, sessionsByProject, streamingSessionId, automatingProjectId, automatingChatId],
  );

  const defaultExpandedIds = useMemo(
    () => (projectId ? [projectId] : []),
    [projectId],
  );

  const defaultSelectedIds = useMemo(() => {
    if (chatSessionId) return [chatSessionId];
    if (projectId) return [projectId];
    return [];
  }, [projectId, chatSessionId]);

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (!id) return;
      if (projectMap.has(id)) {
        if (id !== projectId) sidekick.closePreview();
        navigate(`/projects/${id}`);
      } else if (sessionMeta.has(id)) {
        const { projectId: pid } = sessionMeta.get(id)!;
        if (pid !== projectId) sidekick.closePreview();
        navigate(`/projects/${pid}/chat/${id}`);
      }
    },
    [projectMap, sessionMeta, navigate, projectId, sidekick],
  );

  const handleExpand = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (expanded && projectMap.has(nodeId) && !(nodeId in sessionsByProject)) {
        fetchSessions(nodeId);
      }
    },
    [projectMap, sessionsByProject, fetchSessions],
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

      const meta = sessionMeta.get(nodeId);
      if (meta) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, session: meta.session });
      }
    },
    [projectMap, sessionMeta],
  );

  const handleNewSession = useCallback(
    async (pid: string) => {
      try {
        const session = await api.createChatSession(pid, "New Chat");
        fetchSessions(pid);
        navigate(`/projects/${pid}/chat/${session.chat_session_id}`);
      } catch (err) {
        console.error("Failed to create session", err);
      }
    },
    [fetchSessions, navigate],
  );

  const handleMenuAction = (actionId: string) => {
    if (!ctxMenu) return;
    const target = ctxMenu.project;
    const sessionTarget = ctxMenu.session;
    setCtxMenu(null);

    if (actionId === "new-chat" && target) {
      handleNewSession(target.project_id);
    } else if (actionId === "rename" && target) {
      setRenameTarget(target);
    } else if (actionId === "delete" && target) {
      setDeleteTarget(target);
    } else if (actionId === "delete-session" && sessionTarget) {
      setDeleteSessionTarget(sessionTarget);
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
      setProjects((prev) => [...prev, project]);
      try {
        const session = await api.createChatSession(project.project_id, "New Chat");
        navigate(`/projects/${project.project_id}/chat/${session.chat_session_id}`);
      } catch {
        navigate(`/projects/${project.project_id}`);
      }
    },
    [navigate],
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteProject(deleteTarget.project_id);
      clearLastChatIf({ projectId: deleteTarget.project_id });
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

  const handleDeleteSession = async () => {
    if (!deleteSessionTarget) return;
    const { project_id: pid, chat_session_id: sid } = deleteSessionTarget;
    setDeleteSessionLoading(true);

    const prevSessions = sessionsByProject[pid];
    setSessionsByProject((prev) => ({
      ...prev,
      [pid]: (prev[pid] ?? []).filter((s) => s.chat_session_id !== sid),
    }));

    try {
      await api.deleteChatSession(pid, sid);
      clearLastChatIf({ chatSessionId: sid });
      if (chatSessionId === sid) {
        navigate(`/projects/${pid}/chat`);
      }
      setDeleteSessionTarget(null);
      fetchSessions(pid);
    } catch (err) {
      console.error("Failed to delete session", err);
      if (prevSessions) {
        setSessionsByProject((prev) => ({ ...prev, [pid]: prevSessions }));
      }
    } finally {
      setDeleteSessionLoading(false);
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
              items={ctxMenu.project ? projectMenuItems : sessionMenuItems}
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

      <DeleteSessionModal
        target={deleteSessionTarget}
        loading={deleteSessionLoading}
        onClose={() => setDeleteSessionTarget(null)}
        onDelete={handleDeleteSession}
      />

      <NewProjectModal
        isOpen={showNewProject}
        onClose={handleNewProjectClose}
        onCreated={handleNewProjectCreated}
      />
    </div>
  );
}
