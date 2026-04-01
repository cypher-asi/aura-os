import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useReactFlow,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type EdgeChange,
  applyEdgeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./ProcessCanvas.css";
import { Play, GitBranch, FileOutput, Timer, Merge } from "lucide-react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import type { ProcessNode, ProcessNodeConnection } from "../../../types";
import type { ProcessNodeType } from "../../../types/enums";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
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
    sourceHandle: c.source_handle || null,
    target: c.target_node_id,
    targetHandle: c.target_handle || null,
    animated: true,
    style: { stroke: "#999", strokeWidth: 2 },
  }));
}

const ADD_NODE_TYPES: { type: ProcessNodeType; label: string }[] = [
  { type: "action", label: "Action" },
  { type: "condition", label: "Condition" },
  { type: "artifact", label: "Artifact" },
  { type: "delay", label: "Delay" },
  { type: "merge", label: "Merge" },
];

const NODE_MENU_ICONS: Record<string, React.ReactNode> = {
  action: <Play size={14} />,
  condition: <GitBranch size={14} />,
  artifact: <FileOutput size={14} />,
  delay: <Timer size={14} />,
  merge: <Merge size={14} />,
};

const nodeMenuItems: MenuItem[] = ADD_NODE_TYPES.map((item) => ({
  id: item.type,
  label: item.label,
  icon: NODE_MENU_ICONS[item.type],
}));

export function ProcessCanvas(props: ProcessCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProcessCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function ProcessCanvasInner({ processId, processNodes, processConnections }: ProcessCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(processNodes));
  const [localEdgeAdds, setLocalEdgeAdds] = useState<Edge[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);
  const selectNode = useProcessSidekickStore((s) => s.selectNode);

  useEffect(() => {
    setNodes(toFlowNodes(processNodes));
  }, [processNodes, setNodes]);

  const serverEdges = useMemo(() => toFlowEdges(processConnections), [processConnections]);
  const edges = useMemo(() => [...serverEdges, ...localEdgeAdds], [serverEdges, localEdgeAdds]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setLocalEdgeAdds((prev) => applyEdgeChanges(changes, prev));
  }, []);

  useEffect(() => {
    setLocalEdgeAdds([]);
  }, [processConnections]);

  const onConnect = useCallback(
    async (params: Connection) => {
      const optimisticEdge: Edge = {
        id: `temp-${Date.now()}`,
        source: params.source!,
        target: params.target!,
        sourceHandle: params.sourceHandle ?? null,
        targetHandle: params.targetHandle ?? null,
        animated: true,
        style: { stroke: "#999", strokeWidth: 2 },
      };
      setLocalEdgeAdds((prev) => [...prev, optimisticEdge]);
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
        setLocalEdgeAdds((prev) => prev.filter((e) => e.id !== optimisticEdge.id));
      }
    },
    [processId, fetchConnections],
  );

  const handleAddNode = useCallback(
    async (type: ProcessNodeType, label: string) => {
      if (!ctxMenu) return;
      const flowPos = screenToFlowPosition({ x: ctxMenu.x, y: ctxMenu.y });
      const snappedX = Math.round(flowPos.x / 20) * 20;
      const snappedY = Math.round(flowPos.y / 20) * 20;
      setCtxMenu(null);
      try {
        await processApi.createNode(processId, {
          node_type: type,
          label,
          position_x: snappedX,
          position_y: snappedY,
        });
        fetchNodes(processId);
      } catch (e) {
        console.error("Failed to create node:", e);
      }
    },
    [processId, ctxMenu, screenToFlowPosition, fetchNodes],
  );

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    setCtxMenu({ x: event.clientX, y: event.clientY });
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as HTMLElement)) {
        setCtxMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ctxMenu]);

  const onNodeClick = useCallback(
    (_: unknown, flowNode: Node) => {
      const processNode = processNodes.find((n) => n.node_id === flowNode.id);
      if (processNode) selectNode(processNode);
    },
    [processNodes, selectNode],
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
        onNodeClick={onNodeClick}
        onPaneContextMenu={onPaneContextMenu}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
        defaultEdgeOptions={{ animated: true }}
        connectionLineStyle={{ stroke: "var(--color-text, #eee)", strokeWidth: 2 }}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag
        panOnDrag={[1]}
        panActivationKeyCode="Shift"
        selectionKeyCode={null}
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
          style={{ background: "var(--color-bg-surface, #1a1a2e)", border: "1px solid var(--color-border, #333)", borderRadius: 0, width: 150, height: 112 }}
          nodeColor="var(--color-text-muted, #666)"
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>

      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={nodeMenuItems}
            onChange={(id) => {
              const item = ADD_NODE_TYPES.find((t) => t.type === id);
              if (item) handleAddNode(item.type as ProcessNodeType, item.label);
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
