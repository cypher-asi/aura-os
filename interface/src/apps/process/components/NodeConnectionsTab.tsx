import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft, Trash2 } from "lucide-react";
import { Text, Menu } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../types";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import { EmptyState } from "../../../components/EmptyState";
import styles from "../../../components/Preview/Preview.module.css";

interface NodeConnectionsTabProps {
  node: ProcessNode;
}

const EMPTY_NODES: ProcessNode[] = [];

export function NodeConnectionsTab({ node }: NodeConnectionsTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const connections = useProcessStore((s) => processId ? s.connections[processId] ?? [] : []);
  const nodes = useProcessStore((s) => processId ? s.nodes[processId] ?? EMPTY_NODES : EMPTY_NODES);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);
  const selectNode = useProcessSidekickStore((s) => s.selectNode);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; connectionId: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const outgoing = connections.filter((c) => c.source_node_id === node.node_id);
  const incoming = connections.filter((c) => c.target_node_id === node.node_id);

  const nodeLabel = (id: string) => nodes.find((n) => n.node_id === id)?.label ?? id;
  const findNode = (id: string) => nodes.find((n) => n.node_id === id);

  const handleContextMenu = useCallback((e: React.MouseEvent, connectionId: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, connectionId });
  }, []);

  const handleDelete = useCallback(async (connectionId: string) => {
    if (!processId) return;
    setCtxMenu(null);
    try {
      await processApi.deleteConnection(processId, connectionId);
      fetchConnections(processId);
    } catch (e) {
      console.error("Failed to delete connection:", e);
    }
  }, [processId, fetchConnections]);

  useEffect(() => {
    if (!ctxMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as HTMLElement)) {
        setCtxMenu(null);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [ctxMenu]);

  if (outgoing.length === 0 && incoming.length === 0) {
    return <EmptyState>No connections</EmptyState>;
  }

  return (
    <div className={styles.previewBody}>
      <div className={styles.taskMeta}>
        {incoming.length > 0 && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Incoming ({incoming.length})</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {incoming.map((c) => {
                const source = findNode(c.source_node_id);
                return (
                  <button
                    key={c.connection_id}
                    type="button"
                    onClick={() => source && selectNode(source)}
                    onContextMenu={(e) => handleContextMenu(e, c.connection_id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 8px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: "transparent",
                      cursor: source ? "pointer" : "default",
                      fontSize: 12,
                      color: "var(--color-text)",
                      textAlign: "left",
                    }}
                  >
                    <ArrowLeft size={12} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                    <Text size="sm">{nodeLabel(c.source_node_id)}</Text>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {outgoing.length > 0 && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Outgoing ({outgoing.length})</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {outgoing.map((c) => {
                const target = findNode(c.target_node_id);
                return (
                  <button
                    key={c.connection_id}
                    type="button"
                    onClick={() => target && selectNode(target)}
                    onContextMenu={(e) => handleContextMenu(e, c.connection_id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 8px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: "transparent",
                      cursor: target ? "pointer" : "default",
                      fontSize: 12,
                      color: "var(--color-text)",
                      textAlign: "left",
                    }}
                  >
                    <Text size="sm">{nodeLabel(c.target_node_id)}</Text>
                    <ArrowRight size={12} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={[{ id: "delete", label: "Delete connection", icon: <Trash2 size={14} /> }]}
            onChange={(id) => {
              if (id === "delete") handleDelete(ctxMenu.connectionId);
            }}
            background="solid"
            border="solid"
            rounded="md"
            width={180}
            isOpen
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
