import { useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../types";
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
  const selectNode = useProcessSidekickStore((s) => s.selectNode);

  const outgoing = connections.filter((c) => c.source_node_id === node.node_id);
  const incoming = connections.filter((c) => c.target_node_id === node.node_id);

  const nodeLabel = (id: string) => nodes.find((n) => n.node_id === id)?.label ?? id;
  const findNode = (id: string) => nodes.find((n) => n.node_id === id);

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
    </div>
  );
}
