import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { Explorer, ButtonPlus, Menu, Modal, Button } from "@cypher-asi/zui";
import type { ExplorerNode, MenuItem } from "@cypher-asi/zui";
import { Bot, Loader2, Trash2 } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { AgentEditorModal } from "../../components/AgentEditorModal";
import { api, ApiClientError } from "../../api/client";
import { useAgents, useSelectedAgent, useAgentStore, LAST_AGENT_ID_KEY } from "./stores";
import { useSidebarSearch } from "../../context/SidebarSearchContext";
import type { Agent } from "../../types";
import styles from "./AgentList.module.css";

const agentMenuItems: MenuItem[] = [
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

interface CtxMenuState {
  x: number;
  y: number;
  agent: Agent;
}

export function AgentList() {
  const { agents, status, fetchAgents } = useAgents();
  const { setSelectedAgent } = useSelectedAgent();
  const loading = status === "loading";
  const { query: searchQuery, setAction } = useSidebarSearch();
  const navigate = useNavigate();
  const { agentId } = useParams();
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setAction(
      "agents",
      <ButtonPlus onClick={() => setShowEditor(true)} size="sm" title="New Agent" />,
    );
    return () => setAction("agents", null);
  }, [setAction]);

  useEffect(() => {
    if (status !== "ready") return;
    const lastId = localStorage.getItem(LAST_AGENT_ID_KEY);
    if (lastId && !agentId) {
      useAgentStore.getState().prefetchHistory(lastId);
    }
  }, [status, agentId]);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.agent_id, a])),
    [agents],
  );

  // Dismiss context menu on outside click or Escape
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

  const handleAgentSaved = useCallback(
    (agent: Agent) => {
      setShowEditor(false);
      fetchAgents();
      navigate(`/agents/${agent.agent_id}`);
    },
    [fetchAgents, navigate],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("button[id]");
      if (!target) return;
      const agent = agentMap.get(target.id);
      if (agent) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, agent });
      }
    },
    [agentMap],
  );

  const handleMenuAction = useCallback(
    (actionId: string) => {
      if (!ctxMenu) return;
      if (actionId === "delete") {
        setDeleteTarget(ctxMenu.agent);
        setDeleteError(null);
      }
      setCtxMenu(null);
    },
    [ctxMenu],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.agents.delete(deleteTarget.agent_id);
      if (agentId === deleteTarget.agent_id) {
        setSelectedAgent(null);
        navigate("/agents");
      }
      setDeleteTarget(null);
      useAgentStore.getState().fetchAgents();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setDeleteError(err.body.error);
      } else {
        setDeleteError("Failed to delete agent.");
      }
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, agentId, setSelectedAgent, navigate]);

  const data: ExplorerNode[] = useMemo(
    () =>
      agents.map((a) => ({
        id: a.agent_id,
        label: a.name,
        icon: a.icon && !failedIcons.has(a.agent_id)
          ? <img
              src={a.icon}
              alt=""
              className={styles.agentAvatar}
              onError={() => setFailedIcons((prev) => new Set(prev).add(a.agent_id))}
            />
          : <Bot size={14} />,
      })),
    [agents, failedIcons],
  );

  const filteredData = useMemo(() => {
    if (!searchQuery) return data;
    const q = searchQuery.toLowerCase();
    return data.filter((n) => n.label.toLowerCase().includes(q));
  }, [data, searchQuery]);

  const defaultSelectedIds = useMemo(
    () => (agentId ? [agentId] : []),
    [agentId],
  );

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (id) navigate(`/agents/${id}`);
    },
    [navigate],
  );

  if (loading && agents.length === 0) {
    return (
      <div className={styles.loading}>
        <Loader2 size={18} className={styles.spin} />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <>
        <EmptyState>Add an agent to get started.</EmptyState>
        <AgentEditorModal
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
          onSaved={handleAgentSaved}
        />
      </>
    );
  }

  return (
    <div className={styles.list}>
      <div onContextMenu={handleContextMenu}>
        <Explorer
          data={filteredData}
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultSelectedIds={defaultSelectedIds}
          onSelect={handleSelect}
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
              items={agentMenuItems}
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
        isOpen={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
        title="Delete Agent"
        size="sm"
        footer={
          <div className={styles.confirmFooter}>
            <Button variant="ghost" size="sm" onClick={() => { setDeleteTarget(null); setDeleteError(null); }} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleDelete} disabled={deleteLoading} className={styles.dangerButton}>
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <div className={styles.confirmMessage}>
          Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
        </div>
        {deleteError && <div className={styles.errorText}>{deleteError}</div>}
      </Modal>

      <AgentEditorModal
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        onSaved={handleAgentSaved}
      />
    </div>
  );
}
