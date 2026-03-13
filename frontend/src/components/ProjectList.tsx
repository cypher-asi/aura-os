import { useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Project, ChatSession } from "../types";
import { ButtonPlus, Group, Text, Item, Menu, Modal, ModalConfirm, Input, Button } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { FolderOpen, MessageSquare, ChevronRight, ChevronDown, Pencil, Trash2 } from "lucide-react";
import styles from "./ProjectList.module.css";

const projectMenuItems: MenuItem[] = [
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
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, ChatSession[]>>({});
  const { projectId, chatSessionId } = useParams();
  const navigate = useNavigate();

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<ChatSession | null>(null);
  const [deleteSessionLoading, setDeleteSessionLoading] = useState(false);

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
    if (projectId && !expandedProjects.has(projectId)) {
      setExpandedProjects((prev) => new Set(prev).add(projectId));
    }
  }, [projectId]);

  useEffect(() => {
    for (const pid of expandedProjects) {
      if (!sessionsByProject[pid]) {
        fetchSessions(pid);
      }
    }
  }, [expandedProjects, fetchSessions]);

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

  const toggleExpand = (pid: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  };

  const handleNewSession = async (pid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const session = await api.createChatSession(pid, "New Chat");
      fetchSessions(pid);
      if (!expandedProjects.has(pid)) {
        setExpandedProjects((prev) => new Set(prev).add(pid));
      }
      navigate(`/projects/${pid}/chat/${session.chat_session_id}`);
    } catch (err) {
      console.error("Failed to create session", err);
    }
  };

  const handleProjectContextMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, project });
  };

  const handleSessionContextMenu = (e: React.MouseEvent, session: ChatSession) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, session });
  };

  const handleMenuAction = (actionId: string) => {
    if (!ctxMenu) return;
    const target = ctxMenu.project;
    const sessionTarget = ctxMenu.session;
    setCtxMenu(null);

    if (actionId === "rename" && target) {
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

  const isProjectActive = (pid: string) => projectId === pid;
  const isExpanded = (pid: string) => expandedProjects.has(pid);

  return (
    <div>
      <Group
        label="Projects"
        stats={<ButtonPlus onClick={() => navigate("/new-project")} size="sm" title="New Project" />}
      >
        {projects.length === 0 ? (
          <Text variant="muted" size="sm" style={{ padding: "var(--space-3) var(--space-4)" }}>
            No projects yet
          </Text>
        ) : (
          projects.map((p) => (
            <div key={p.project_id}>
              <Item
                selected={isProjectActive(p.project_id) && !chatSessionId}
                onClick={() => {
                  toggleExpand(p.project_id);
                  navigate(`/projects/${p.project_id}`);
                }}
                onContextMenu={(e: React.MouseEvent) => handleProjectContextMenu(e, p)}
              >
                <Item.Icon>
                  {isExpanded(p.project_id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </Item.Icon>
                <Item.Label>{p.name}</Item.Label>
                <span
                  className={styles.sessionPlusBtn}
                  onClick={(e) => handleNewSession(p.project_id, e)}
                  title="New Chat"
                >
                  <ButtonPlus size="sm" />
                </span>
              </Item>

              {isExpanded(p.project_id) && (
                <div className={styles.sessionList}>
                  {(sessionsByProject[p.project_id] || []).map((s) => (
                    <Item
                      key={s.chat_session_id}
                      selected={chatSessionId === s.chat_session_id}
                      onClick={() => navigate(`/projects/${p.project_id}/chat/${s.chat_session_id}`)}
                      onContextMenu={(e: React.MouseEvent) => handleSessionContextMenu(e, s)}
                    >
                      <Item.Icon><MessageSquare size={12} /></Item.Icon>
                      <Item.Label>{s.title}</Item.Label>
                    </Item>
                  ))}
                  {(sessionsByProject[p.project_id] || []).length === 0 && (
                    <Text variant="muted" size="sm" className={styles.noSessions}>
                      No chats yet
                    </Text>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </Group>

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

      <ModalConfirm
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Project"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel={deleteLoading ? "Deleting..." : "Delete"}
        cancelLabel="Cancel"
        danger
        isLoading={deleteLoading}
      />

      <ModalConfirm
        isOpen={!!deleteSessionTarget}
        onClose={() => setDeleteSessionTarget(null)}
        onConfirm={handleDeleteSession}
        title="Delete Chat"
        message={`Are you sure you want to delete this chat session? This action cannot be undone.`}
        confirmLabel={deleteSessionLoading ? "Deleting..." : "Delete"}
        cancelLabel="Cancel"
        danger
        isLoading={deleteSessionLoading}
      />
    </div>
  );
}
