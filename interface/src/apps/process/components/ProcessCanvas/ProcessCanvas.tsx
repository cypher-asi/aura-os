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
import { useProcessStore, type ProcessViewport } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { ProcessNodeCard } from "../ProcessNodeCard";
import { ProcessGroupNode } from "../ProcessGroupNode";
import {
  type ProcessCanvasProps,
  GRID,
  EMPTY_RUNS,
  toFlowNodes,
  toFlowEdges,
} from "./process-canvas-utils";
import { useCanvasEventHandlers } from "./useCanvasEventHandlers";
import { useProcessCanvasFlowSync } from "./useProcessCanvasFlowSync";
import { ProcessCanvasFloatingToolbar } from "./ProcessCanvasFloatingToolbar";
import { ProcessCanvasContextMenus } from "./ProcessCanvasContextMenus";

const nodeTypes = { processNode: ProcessNodeCard, groupNode: ProcessGroupNode };
const DEFAULT_VIEWPORT: ProcessViewport = { x: 0, y: 0, zoom: 1 };

export function ProcessCanvas(props: ProcessCanvasProps) {
  const savedViewport = useProcessStore((s) => s.viewports[props.processId]);

  return (
    <ReactFlowProvider key={props.processId}>
      <ProcessCanvasInner {...props} savedViewport={savedViewport} />
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
  savedViewport,
}: ProcessCanvasProps & { savedViewport?: ProcessViewport }) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);
  const saveViewport = useProcessStore((s) => s.setViewport);
  const runs = useProcessStore((s) => s.runs[processId]) ?? EMPTY_RUNS;
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const isRunActive = runs.length > 0 && (runs[0].status === "running" || runs[0].status === "pending");

  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(processNodes, undefined, nodeStatuses));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(processConnections, processNodes));

  const {
    renameState,
    setRenamingNodeId,
    wrapperRef,
    onConnect,
    onNodeDragStop,
    onGroupResizeStop,
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
    requestDeleteNodes,
    pendingDeleteNodeIds,
    confirmDeleteNodes,
    cancelDeleteNodes,
    togglePinNode,
    deleteConnection,
    disconnectNode,
    copyNodes,
    pasteNodes,
    duplicateNodes,
    hasClipboard,
    setCtxMenu,
    setNodeCtxMenu,
    setEdgeCtxMenu,
    setSelectionCtxMenu,
    ctxMenu,
    nodeCtxMenu,
    edgeCtxMenu,
    selectionCtxMenu,
    ctxMenuRef,
    nodeCtxMenuRef,
    edgeCtxMenuRef,
    selectionCtxMenuRef,
  } = useCanvasEventHandlers({
    processId,
    processNodes,
    processConnections,
    runs,
    nodes,
    setNodes,
    edges,
    setEdges,
    screenToFlowPosition,
    fetchNodes,
    fetchConnections,
  });

  useProcessCanvasFlowSync({
    processNodes,
    processConnections,
    renameState,
    nodeStatuses,
    onGroupResizeStop,
    setNodes,
    setEdges,
    savedViewport,
    nodeCount: nodes.length,
    fitView,
  });

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
        onMoveEnd={(_event, viewport) => saveViewport(processId, viewport)}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        connectionMode={ConnectionMode.Strict}
        defaultViewport={savedViewport ?? DEFAULT_VIEWPORT}
        fitView={!savedViewport}
        snapToGrid
        snapGrid={[GRID, GRID]}
        defaultEdgeOptions={{ animated: true, type: "step" }}
        connectionLineStyle={{ stroke: "rgba(255, 255, 255, 0.55)", strokeWidth: 1 }}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1]}
        panActivationKeyCode="Shift"
        selectionKeyCode={null}
        multiSelectionKeyCode="Control"
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
        <ProcessCanvasFloatingToolbar
          isRunActive={isRunActive}
          isEnabled={isEnabled}
          onTrigger={onTrigger}
          onToggle={onToggle}
          onStop={onStop}
        />
      )}

      <ProcessCanvasContextMenus
        processNodes={processNodes}
        runs={runs}
        edges={edges}
        hasClipboard={hasClipboard}
        ctxMenu={ctxMenu}
        nodeCtxMenu={nodeCtxMenu}
        edgeCtxMenu={edgeCtxMenu}
        selectionCtxMenu={selectionCtxMenu}
        ctxMenuRef={ctxMenuRef}
        nodeCtxMenuRef={nodeCtxMenuRef}
        edgeCtxMenuRef={edgeCtxMenuRef}
        selectionCtxMenuRef={selectionCtxMenuRef}
        setCtxMenu={setCtxMenu}
        setNodeCtxMenu={setNodeCtxMenu}
        setEdgeCtxMenu={setEdgeCtxMenu}
        setSelectionCtxMenu={setSelectionCtxMenu}
        setRenamingNodeId={setRenamingNodeId}
        pasteNodes={pasteNodes}
        handleAddNode={handleAddNode}
        copyNodes={copyNodes}
        deleteNodes={deleteNodes}
        duplicateNodes={duplicateNodes}
        requestDeleteNodes={requestDeleteNodes}
        togglePinNode={togglePinNode}
        disconnectNode={disconnectNode}
        deleteConnection={deleteConnection}
        pendingDeleteNodeIds={pendingDeleteNodeIds}
        confirmDeleteNodes={confirmDeleteNodes}
        cancelDeleteNodes={cancelDeleteNodes}
      />
    </div>
  );
}
