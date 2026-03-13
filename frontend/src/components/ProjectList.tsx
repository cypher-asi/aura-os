import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import type { Project, ChatSession } from "../types";
import { ButtonPlus, Explorer, Menu, Modal, Input, Button, Text } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { Plus, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { NewProjectModal } from "./NewProjectModal";
import styles from "./ProjectList.module.css";

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<ChatSession | null>(null);
  const [deleteSessionLoading, setDeleteSessionLoading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const fetchProjects = useCallback(() => {
    api.listProjects().then(setProjects).catch(console.error);
  }, []);

  const fetchSessions = useCallback((pid: string) => {
    api.listChatSessions(pid).then((sessions) => {
      setSessionsByProject((prev) => ({ ...prev, [pid]: sessions }));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (projectId && !(projectId in sessionsByProject)) {
      fetchSessions(projectId);
    }
  }, [projectId]);

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

  // Lookup maps for navigation from Explorer selection
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
            <button
              type="button"
              className={styles.newChatButton}
              onClick={(e) => {
                e.stopPropagation();
                handleNewSession(p.project_id);
              }}
              aria-label="New Chat"
            >
              <Plus size={14} />
            </button>
          </span>
        ),
        metadata: { type: "project" },
        children:
          sessionsByProject[p.project_id] !== undefined
            ? sessionsByProject[p.project_id].map((s) => ({
                id: s.chat_session_id,
                label: s.title,
                suffix:
                  streamingSessionId === s.chat_session_id ? (
                    <span className={styles.streamingDot} />
                  ) : (
                    <span className={styles.sessionTime}>
                      {formatRelativeTime(s.updated_at)}
                    </span>
                  ),
                metadata: { type: "session", projectId: p.project_id },
              }))
            : [{ id: `_load_${p.project_id}`, label: "Loading...", disabled: true }],
      })),
    [projects, sessionsByProject, streamingSessionId],
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
        navigate(`/projects/${id}`);
      } else if (sessionMeta.has(id)) {
        const { projectId: pid } = sessionMeta.get(id)!;
        navigate(`/projects/${pid}/chat/${id}`);
      }
    },
    [projectMap, sessionMeta, navigate],
  );

  const handleExpand = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (expanded && projectMap.has(nodeId) && !(nodeId in sessionsByProject)) {
        fetchSessions(nodeId);
      }
    },
    [projectMap, sessionsByProject, fetchSessions],
  );

  // Context menu via event delegation on the Explorer wrapper
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
      setRenameName(target.name);
      setRenameTarget(target);
    } else if (actionId === "delete" && target) {
      setDeleteTarget(target);
    } else if (actionId === "delete-session" && sessionTarget) {
      setDeleteSessionTarget(sessionTarget);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      await api.updateProject(renameTarget.project_id, { name: renameName.trim() });
      setRenameTarget(null);
      fetchProjects();
    } catch (err) {
      console.error("Failed to rename project", err);
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteProject(deleteTarget.project_id);
      try {
        const last = JSON.parse(localStorage.getItem("aura-last-chat") || "{}");
        if (last.projectId === deleteTarget.project_id) {
          localStorage.removeItem("aura-last-chat");
        }
      } catch { /* ignore */ }
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
    setDeleteSessionLoading(true);
    try {
      await api.deleteChatSession(deleteSessionTarget.project_id, deleteSessionTarget.chat_session_id);
      try {
        const last = JSON.parse(localStorage.getItem("aura-last-chat") || "{}");
        if (last.chatSessionId === deleteSessionTarget.chat_session_id) {
          localStorage.removeItem("aura-last-chat");
        }
      } catch { /* ignore */ }
      if (chatSessionId === deleteSessionTarget.chat_session_id) {
        navigate(`/projects/${deleteSessionTarget.project_id}/chat`);
      }
      fetchSessions(deleteSessionTarget.project_id);
      setDeleteSessionTarget(null);
    } catch (err) {
      console.error("Failed to delete session", err);
    } finally {
      setDeleteSessionLoading(false);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.explorerWrap} onContextMenu={handleContextMenu}>
        <div className={styles.addButton}>
          <ButtonPlus onClick={() => setShowNewProject(true)} size="sm" title="New Project" />
        </div>
        <Explorer
          data={explorerData}
          searchable
          searchPlaceholder="Search"
          expandOnSelect
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultExpandedIds={defaultExpandedIds}
          defaultSelectedIds={defaultSelectedIds}
          onSelect={handleSelect}
          onExpand={handleExpand}
        />
      </div>

      {projects.length === 0 && (
        <Text variant="muted" size="sm" style={{ padding: "var(--space-3) var(--space-4)" }}>
          No projects yet
        </Text>
      )}

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

      <Modal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename Project"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleRename} disabled={renameLoading || !renameName.trim()}>
              {renameLoading ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
          placeholder="Project name"
          autoFocus
        />
      </Modal>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Project"
        size="sm"
        footer={
          <div className={styles.confirmFooter}>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleDelete} disabled={deleteLoading} className={styles.dangerButton}>
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <div className={styles.confirmMessage}>
          Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
        </div>
      </Modal>

      <Modal
        isOpen={!!deleteSessionTarget}
        onClose={() => setDeleteSessionTarget(null)}
        title="Delete Chat"
        size="sm"
        footer={
          <div className={styles.confirmFooter}>
            <Button variant="ghost" size="sm" onClick={() => setDeleteSessionTarget(null)} disabled={deleteSessionLoading}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleDeleteSession} disabled={deleteSessionLoading} className={styles.dangerButton}>
              {deleteSessionLoading ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <div className={styles.confirmMessage}>
          Are you sure you want to delete this chat session? This action cannot be undone.
        </div>
      </Modal>

      <NewProjectModal
        isOpen={showNewProject}
        onClose={() => setShowNewProject(false)}
        onCreated={(pid) => {
          setShowNewProject(false);
          fetchProjects();
          navigate(`/projects/${pid}`);
        }}
      />
    </div>
  );
}
