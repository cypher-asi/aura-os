import { useCallback, useEffect, useRef, useState } from "react";
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
  type Connection,
  type Node,
  type Edge,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./ProcessCanvas.css";
import { Play, GitBranch, FileOutput, Timer, Merge, Pencil, Trash2 } from "lucide-react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import type { ProcessNode, ProcessNodeConnection } from "../../../types";
import type { ProcessNodeType } from "../../../types/enums";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore, type NodeRunStatus } from "../stores/process-sidekick-store";
import { ProcessNodeCard } from "./ProcessNodeCard";

const nodeTypes = { processNode: ProcessNodeCard };

interface ProcessCanvasProps {
  processId: string;
  processNodes: ProcessNode[];
  processConnections: ProcessNodeConnection[];
}

interface RenameState {
  nodeId: string;
  onRenameSubmit: (newLabel: string) => void;
}

function toFlowNodes(
  nodes: ProcessNode[],
  renaming?: RenameState,
  nodeStatuses?: Record<string, NodeRunStatus>,
): Node[] {
  return nodes.map((n) => ({
    id: n.node_id,
    type: "processNode",
    position: { x: n.position_x, y: n.position_y },
    data: {
      label: n.label,
      nodeType: n.node_type,
      prompt: n.prompt,
      agentId: n.agent_id,
      runStatus: nodeStatuses?.[n.node_id],
      ...(renaming && renaming.nodeId === n.node_id
        ? { isRenaming: true, onRenameSubmit: renaming.onRenameSubmit }
        : {}),
    },
  }));
}

function normalizeHandleId(
  rawHandle: string | null,
  direction: "source" | "target",
  nodeType: ProcessNodeType | undefined,
): string | undefined {
  const normalized = (rawHandle ?? "").trim().toLowerCase();

  if (direction === "source") {
    if (nodeType === "condition" && ["out-false", "false", "branch-false"].includes(normalized)) {
      return "false";
    }
    return undefined;
  }

  if (nodeType === "merge" && ["in-2", "merge-2", "second", "2"].includes(normalized)) {
    return "merge-2";
  }
  return undefined;
}

function toFlowEdges(connections: ProcessNodeConnection[], nodes: ProcessNode[]): Edge[] {
  const nodeTypeById = new Map(nodes.map((n) => [n.node_id, n.node_type]));
  return connections.map((c) => {
    const sourceHandle = normalizeHandleId(
      c.source_handle,
      "source",
      nodeTypeById.get(c.source_node_id),
    );
    const targetHandle = normalizeHandleId(
      c.target_handle,
      "target",
      nodeTypeById.get(c.target_node_id),
    );

    return {
      id: c.connection_id,
      source: c.source_node_id,
      ...(sourceHandle ? { sourceHandle } : {}),
      target: c.target_node_id,
      ...(targetHandle ? { targetHandle } : {}),
      animated: true,
    };
  });
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

function ProcessCanvasInner({ processId, processNodes, processConnections }: ProcessCanvasProps) {
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);

  const { screenToFlowPosition } = useReactFlow();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);
  const selectNode = useProcessSidekickStore((s) => s.selectNode);
  const closeNodeInspector = useProcessSidekickStore((s) => s.closeNodeInspector);
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);

  const handleRenameSubmit = useCallback(
    async (nodeId: string, newLabel: string) => {
      setRenamingNodeId(null);
      const original = processNodes.find((n) => n.node_id === nodeId);
      if (!original || original.label === newLabel) return;
      try {
        await processApi.updateNode(processId, nodeId, { label: newLabel });
        fetchNodes(processId);
      } catch (e) {
        console.error("Failed to rename node:", e);
      }
    },
    [processId, processNodes, fetchNodes],
  );

  const renameState: RenameState | undefined = renamingNodeId
    ? { nodeId: renamingNodeId, onRenameSubmit: (label: string) => handleRenameSubmit(renamingNodeId, label) }
    : undefined;

  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(processNodes, renameState, nodeStatuses));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(processConnections, processNodes));
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [nodeCtxMenu, setNodeCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const nodeCtxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNodes(toFlowNodes(processNodes, renameState, nodeStatuses));
  }, [processNodes, setNodes, renamingNodeId, nodeStatuses]);

  useEffect(() => {
    setEdges(toFlowEdges(processConnections, processNodes));
  }, [processConnections, processNodes, setEdges]);

  const deleteNodes = useCallback(
    async (nodeIds: string[]) => {
      const deletable = nodeIds.filter((id) => {
        const n = processNodes.find((pn) => pn.node_id === id);
        return n && n.node_type !== "ignition";
      });
      if (deletable.length === 0) return;
      setNodes((prev) => prev.filter((n) => !deletable.includes(n.id)));
      setEdges((prev) => prev.filter((e) => !deletable.includes(e.source) && !deletable.includes(e.target)));
      closeNodeInspector();
      try {
        await Promise.all(deletable.map((id) => processApi.deleteNode(processId, id)));
      } catch (e) {
        console.error("Failed to delete nodes:", e);
      }
      fetchNodes(processId);
      fetchConnections(processId);
    },
    [processId, processNodes, setNodes, setEdges, fetchNodes, fetchConnections, closeNodeInspector],
  );

  const onConnect = useCallback(
    async (params: Connection) => {
      const tempId = `temp-${Date.now()}`;
      const optimisticEdge: Edge = {
        id: tempId,
        source: params.source!,
        target: params.target!,
        ...(params.sourceHandle ? { sourceHandle: params.sourceHandle } : {}),
        ...(params.targetHandle ? { targetHandle: params.targetHandle } : {}),
        animated: true,
      };
      setEdges((prev) => [...prev, optimisticEdge]);
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
        setEdges((prev) => prev.filter((edge) => edge.id !== tempId));
      }
    },
    [processId, fetchConnections, setEdges],
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
    setNodeCtxMenu(null);
    setCtxMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setCtxMenu(null);
      setNodeCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [],
  );

  const onSelectionContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const selected = nodes.filter((n) => n.selected);
      if (selected.length === 1) {
        setCtxMenu(null);
        setNodeCtxMenu({ x: event.clientX, y: event.clientY, nodeId: selected[0].id });
      }
    },
    [nodes],
  );

  useEffect(() => {
    const activeMenu = ctxMenu ? ctxMenuRef : nodeCtxMenu ? nodeCtxMenuRef : null;
    if (!activeMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (activeMenu.current && !activeMenu.current.contains(e.target as HTMLElement)) {
        setCtxMenu(null);
        setNodeCtxMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCtxMenu(null); setNodeCtxMenu(null); }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ctxMenu, nodeCtxMenu]);

  const onNodeClick = useCallback(
    (_: unknown, flowNode: Node) => {
      const processNode = processNodes.find((n) => n.node_id === flowNode.id);
      if (processNode) selectNode(processNode);
    },
    [processNodes, selectNode],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      if (selectedNodes.length === 1) {
        const processNode = processNodes.find((n) => n.node_id === selectedNodes[0].id);
        if (processNode) selectNode(processNode);
      }
    },
    [processNodes, selectNode],
  );

  const onPaneClick = useCallback(() => {
    closeNodeInspector();
  }, [closeNodeInspector]);

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

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const getPane = () => el.querySelector<HTMLElement>(".react-flow__pane");

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") getPane()?.classList.add("dragging");

      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        const selected = nodes.filter((n) => n.selected).map((n) => n.id);
        if (selected.length > 0) deleteNodes(selected);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") getPane()?.classList.remove("dragging");
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) getPane()?.classList.add("dragging");
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 1) getPane()?.classList.remove("dragging");
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mouseup", onMouseUp);
    };
  }, [nodes, deleteNodes]);

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
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        connectionMode={ConnectionMode.Strict}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#444" />
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
          style={{ background: "#111", border: "1px solid var(--color-border, #333)", borderRadius: 0, width: 150, height: 112 }}
          nodeColor="#666"
          maskColor="rgba(0,0,0,0.8)"
          pannable
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
    </div>
  );
}
