import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./ProcessCanvas.css";
import { Plus } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import type { ProcessNode, ProcessNodeConnection } from "../../../types";
import type { ProcessNodeType } from "../../../types/enums";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { ProcessNodeCard } from "./ProcessNodeCard";

const nodeTypes = { processNode: ProcessNodeCard };

interface ProcessCanvasProps {
  processId: string;
  processNodes: ProcessNode[];
  processConnections: ProcessNodeConnection[];
}

function toFlowNodes(nodes: ProcessNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.node_id,
    type: "processNode",
    position: { x: n.position_x, y: n.position_y },
    data: { label: n.label, nodeType: n.node_type, prompt: n.prompt },
  }));
}

function toFlowEdges(connections: ProcessNodeConnection[]): Edge[] {
  return connections.map((c) => ({
    id: c.connection_id,
    source: c.source_node_id,
    sourceHandle: c.source_handle ?? undefined,
    target: c.target_node_id,
    targetHandle: c.target_handle ?? undefined,
    animated: true,
    style: { stroke: "var(--color-text-muted, #666)", strokeWidth: 2 },
  }));
}

const ADD_NODE_TYPES: { type: ProcessNodeType; label: string }[] = [
  { type: "action", label: "Action" },
  { type: "condition", label: "Condition" },
  { type: "artifact", label: "Artifact" },
  { type: "delay", label: "Delay" },
  { type: "merge", label: "Merge" },
];

export function ProcessCanvas({ processId, processNodes, processConnections }: ProcessCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(processNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(processConnections));
  const [showAddMenu, setShowAddMenu] = useState(false);
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);

  // Sync when processNodes/processConnections change from the store
  useMemo(() => {
    setNodes(toFlowNodes(processNodes));
  }, [processNodes, setNodes]);

  useMemo(() => {
    setEdges(toFlowEdges(processConnections));
  }, [processConnections, setEdges]);

  const onConnect = useCallback(
    async (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: "var(--color-text-muted, #666)", strokeWidth: 2 } }, eds));
      try {
        await processApi.createConnection(processId, {
          source_node_id: params.source!,
          source_handle: params.sourceHandle ?? undefined,
          target_node_id: params.target!,
          target_handle: params.targetHandle ?? undefined,
        });
        fetchConnections(processId);
      } catch (e) {
        console.error("Failed to save connection:", e);
      }
    },
    [processId, setEdges, fetchConnections],
  );

  const handleAddNode = useCallback(
    async (type: ProcessNodeType, label: string) => {
      setShowAddMenu(false);
      const yPositions = processNodes.map((n) => n.position_y);
      const maxY = yPositions.length > 0 ? Math.max(...yPositions) : 0;
      try {
        await processApi.createNode(processId, {
          node_type: type,
          label,
          position_x: 250,
          position_y: maxY + 120,
        });
        fetchNodes(processId);
      } catch (e) {
        console.error("Failed to create node:", e);
      }
    },
    [processId, processNodes, fetchNodes],
  );

  const onNodeDragStop = useCallback(
    async (_: unknown, node: Node) => {
      try {
        await processApi.updateNode(processId, node.id, {
          position_x: node.position.x,
          position_y: node.position.y,
        });
      } catch (e) {
        console.error("Failed to save node position:", e);
      }
    },
    [processId],
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
        defaultEdgeOptions={{ animated: true }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "var(--color-bg, #0d0d1a)" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border, #222)" />
        <Controls
          showInteractive={false}
          style={{
            background: "transparent",
            border: "none",
            borderRadius: 8,
            boxShadow: "none",
          }}
          className="process-flow-controls"
        />
        <MiniMap
          style={{ background: "var(--color-bg-surface, #1a1a2e)", border: "1px solid var(--color-border, #333)", borderRadius: 0 }}
          nodeColor="var(--color-text-muted, #666)"
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>

      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10 }}>
        <div style={{ position: "relative" }}>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setShowAddMenu((prev) => !prev)}
          >
            Add Node
          </Button>
          {showAddMenu && (
            <div
              style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4,
                background: "var(--color-bg-surface, #1a1a2e)",
                border: "1px solid var(--color-border, #333)",
                borderRadius: 8, padding: 4, minWidth: 160,
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              }}
            >
              {ADD_NODE_TYPES.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => handleAddNode(item.type, item.label)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 12px", fontSize: 13,
                    color: "var(--color-text, #eee)",
                    background: "transparent", border: "none", borderRadius: 6,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--color-bg-hover, #ffffff10)"; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
