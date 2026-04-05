import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BackgroundVariant,
  ConnectionMode,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import styles from "./ProcessCanvas.module.css";
import { Play, Pause, Square, GitBranch, FileOutput, Timer, Merge, Pencil, Trash2 } from "lucide-react";
import { Button, Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import type { ProcessNodeType } from "../../../../types/enums";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { ProcessNodeCard } from "../ProcessNodeCard";
import {
  type ProcessCanvasProps,
  GRID,
  EMPTY_RUNS,
  ADD_NODE_TYPES,
  toFlowNodes,
  toFlowEdges,
} from "./process-canvas-utils";
import { useCanvasEventHandlers } from "./useCanvasEventHandlers";

const nodeTypes = { processNode: ProcessNodeCard };

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

const nodeCtxMenuItems = (isIgnition: boolean): MenuItem[] => [
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" as const },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} />, disabled: isIgnition },
];

export function ProcessCanvas(props: ProcessCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProcessCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function ProcessCanvasInner({
  processId,
  processNodes,
  processConnections,
  onTrigger,
  onToggle,
  onStop,
  isEnabled,
}: ProcessCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);
  const runs = useProcessStore((s) => s.runs[processId]) ?? EMPTY_RUNS;
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const isRunActive = runs.length > 0 && (runs[0].status === "running" || runs[0].status === "pending");

  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(processNodes, undefined, nodeStatuses));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(processConnections, processNodes));

  const {
    renameState,
    renamingNodeId,
    setRenamingNodeId,
    wrapperRef,
    onConnect,
    onNodeDragStop,
    onNodeClick,
    onNodeDoubleClick,
    onSelectionChange,
    onPaneClick,
    onPaneContextMenu,
    onNodeContextMenu,
    onEdgeContextMenu,
    onSelectionContextMenu,
    handleAddNode,
    deleteNodes,
    deleteConnection,
    setNodeCtxMenu,
    setEdgeCtxMenu,
    ctxMenu,
    nodeCtxMenu,
    edgeCtxMenu,
    ctxMenuRef,
    nodeCtxMenuRef,
    edgeCtxMenuRef,
  } = useCanvasEventHandlers({
    processId,
    processNodes,
    nodes,
    setNodes,
    edges,
    setEdges,
    screenToFlowPosition,
    fetchNodes,
    fetchConnections,
  });

  useEffect(() => {
    setNodes((currentNodes) => {
      const incoming = toFlowNodes(processNodes, renameState, nodeStatuses);
      if (currentNodes.length === 0) return incoming;
      const currentById = new Map(currentNodes.map((n) => [n.id, n]));
      return incoming.map((n) => {
        const existing = currentById.get(n.id);
        return existing ? { ...existing, data: n.data } : n;
      });
    });
  }, [processNodes, setNodes, renamingNodeId, nodeStatuses]);

  useEffect(() => {
    setEdges(toFlowEdges(processConnections, processNodes));
  }, [processConnections, processNodes, setEdges]);

  return (
    <div ref={wrapperRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        connectionMode={ConnectionMode.Strict}
        fitView
        snapToGrid
        snapGrid={[GRID, GRID]}
        defaultEdgeOptions={{ animated: true }}
        connectionLineStyle={{ stroke: "rgba(255, 255, 255, 0.55)", strokeWidth: 1 }}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1]}
        panActivationKeyCode="Shift"
        selectionKeyCode={null}
        style={{ background: "var(--color-bg, #0d0d1a)" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} color="#444" />
        <Controls
          showInteractive={false}
          style={{
            background: "transparent",
            border: "none",
            borderRadius: 8,
            boxShadow: "none",
          }}
          className={styles.flowControls}
        />
        <MiniMap
          style={{ background: "#111", borderRadius: 0, width: 150, height: 112 }}
          nodeColor="#666"
          maskColor="rgba(0,0,0,0.8)"
          pannable
        />
      </ReactFlow>

      {onTrigger && (
        <div className={styles.floatingToolbar}>
          <Button variant="ghost" size="sm" iconOnly icon={<Play size={14} />} title={isRunActive ? "Run in progress" : "Trigger"} onClick={onTrigger} disabled={isRunActive} />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={isEnabled ? <Pause size={14} /> : <Play size={14} />}
            title={isEnabled ? "Pause" : "Resume"}
            onClick={onToggle}
          />
          <Button variant="ghost" size="sm" iconOnly icon={<Square size={14} />} title="Stop" onClick={onStop} disabled={!isRunActive} />
        </div>
      )}

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

      {nodeCtxMenu && createPortal(
        <div
          ref={nodeCtxMenuRef}
          style={{ position: "fixed", left: nodeCtxMenu.x, top: nodeCtxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={nodeCtxMenuItems(
              processNodes.find((n) => n.node_id === nodeCtxMenu.nodeId)?.node_type === "ignition",
            )}
            onChange={(id) => {
              const targetId = nodeCtxMenu.nodeId;
              setNodeCtxMenu(null);
              if (id === "rename") setRenamingNodeId(targetId);
              if (id === "delete") deleteNodes([targetId]);
            }}
            background="solid"
            border="solid"
            rounded="md"
            width={160}
            isOpen
          />
        </div>,
        document.body,
      )}

      {edgeCtxMenu && createPortal(
        <div
          ref={edgeCtxMenuRef}
          style={{ position: "fixed", left: edgeCtxMenu.x, top: edgeCtxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={[{ id: "delete", label: "Delete connection", icon: <Trash2 size={14} /> }]}
            onChange={(id) => {
              if (id === "delete") deleteConnection(edgeCtxMenu.edgeId);
              setEdgeCtxMenu(null);
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
