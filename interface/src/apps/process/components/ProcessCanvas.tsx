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
import { Play, Pause, Square, GitBranch, FileOutput, Timer, Merge, Pencil, Trash2 } from "lucide-react";
import { Button, Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import type { ProcessNode, ProcessNodeConnection, ProcessRun } from "../../../types";
import type { ProcessNodeType } from "../../../types/enums";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore, type NodeRunStatus } from "../stores/process-sidekick-store";
import { ProcessNodeCard } from "./ProcessNodeCard";

const nodeTypes = { processNode: ProcessNodeCard };
const EMPTY_RUNS: ProcessRun[] = [];

interface ProcessCanvasProps {
  processId: string;
  processNodes: ProcessNode[];
  processConnections: ProcessNodeConnection[];
  onTrigger?: () => void;
  onToggle?: () => void;
  onStop?: () => void;
  isEnabled?: boolean;
}

interface RenameState {
  nodeId: string;
  onRenameSubmit: (newLabel: string) => void;
}

const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;

function toFlowNodes(
  nodes: ProcessNode[],
  renaming?: RenameState,
  nodeStatuses?: Record<string, NodeRunStatus>,
): Node[] {
  return nodes.map((n) => ({
    id: n.node_id,
    type: "processNode",
    position: { x: snap(n.position_x), y: snap(n.position_y) },
    data: {
      label: n.label,
      nodeType: n.node_type,
      prompt: n.prompt,
      agentId: n.agent_id,
      isPinned: !!n.config?.pinned_output,
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

function ProcessCanvasInner({ processId, processNodes, processConnections, onTrigger, onToggle, onStop, isEnabled }: ProcessCanvasProps) {
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);

  const { screenToFlowPosition } = useReactFlow();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);
  const runs = useProcessStore((s) => s.runs[processId]) ?? EMPTY_RUNS;
  const selectNode = useProcessSidekickStore((s) => s.selectNode);
  const closeNodeInspector = useProcessSidekickStore((s) => s.closeNodeInspector);
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);

  const isRunActive = runs.length > 0 && (runs[0].status === "running" || runs[0].status === "pending");

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
  const [edgeCtxMenu, setEdgeCtxMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const nodeCtxMenuRef = useRef<HTMLDivElement>(null);
  const edgeCtxMenuRef = useRef<HTMLDivElement>(null);

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
      const duplicate = edges.some(
        (e) =>
          e.source === params.source &&
          e.target === params.target &&
          (e.sourceHandle ?? null) === (params.sourceHandle ?? null) &&
          (e.targetHandle ?? null) === (params.targetHandle ?? null),
      );
      if (duplicate) return;

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
    [processId, fetchConnections, setEdges, edges],
  );

  const handleAddNode = useCallback(
    async (type: ProcessNodeType, label: string) => {
      if (!ctxMenu) return;
      const flowPos = screenToFlowPosition({ x: ctxMenu.x, y: ctxMenu.y });
      setCtxMenu(null);
      try {
        await processApi.createNode(processId, {
          node_type: type,
          label,
          position_x: snap(flowPos.x),
          position_y: snap(flowPos.y),
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
    setEdgeCtxMenu(null);
    setCtxMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setCtxMenu(null);
      setEdgeCtxMenu(null);
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

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setCtxMenu(null);
      setNodeCtxMenu(null);
      setEdgeCtxMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    [],
  );

  const deleteConnection = useCallback(
    async (connectionId: string) => {
      setEdges((prev) => prev.filter((e) => e.id !== connectionId));
      try {
        await processApi.deleteConnection(processId, connectionId);
      } catch (e) {
        console.error("Failed to delete connection:", e);
      }
      fetchConnections(processId);
    },
    [processId, setEdges, fetchConnections],
  );

  useEffect(() => {
    const activeMenu = ctxMenu ? ctxMenuRef : nodeCtxMenu ? nodeCtxMenuRef : edgeCtxMenu ? edgeCtxMenuRef : null;
    if (!activeMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (activeMenu.current && !activeMenu.current.contains(e.target as HTMLElement)) {
        setCtxMenu(null);
        setNodeCtxMenu(null);
        setEdgeCtxMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCtxMenu(null); setNodeCtxMenu(null); setEdgeCtxMenu(null); }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ctxMenu, nodeCtxMenu, edgeCtxMenu]);

  const requestEdit = useProcessSidekickStore((s) => s.requestEdit);

  const onNodeClick = useCallback(
    (_: unknown, flowNode: Node) => {
      const processNode = processNodes.find((n) => n.node_id === flowNode.id);
      if (processNode) selectNode(processNode);
    },
    [processNodes, selectNode],
  );

  const onNodeDoubleClick = useCallback(
    (_: unknown, flowNode: Node) => {
      const processNode = processNodes.find((n) => n.node_id === flowNode.id);
      if (processNode) {
        selectNode(processNode);
        requestEdit();
      }
    },
    [processNodes, selectNode, requestEdit],
  );

  const lastSelectedRef = useRef<string | null>(null);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      if (selectedNodes.length === 1) {
        const id = selectedNodes[0].id;
        if (id !== lastSelectedRef.current) {
          lastSelectedRef.current = id;
          const processNode = processNodes.find((n) => n.node_id === id);
          if (processNode) selectNode(processNode);
        }
      } else {
        lastSelectedRef.current = null;
      }
    },
    [processNodes, selectNode],
  );

  const onPaneClick = useCallback(() => {
    lastSelectedRef.current = null;
    closeNodeInspector();
  }, [closeNodeInspector]);

  const onNodeDragStop = useCallback(
    async (_: unknown, node: Node) => {
      try {
        await processApi.updateNode(processId, node.id, {
          position_x: snap(node.position.x),
          position_y: snap(node.position.y),
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
          className="process-flow-controls"
        />
        <MiniMap
          style={{ background: "#111", borderRadius: 0, width: 150, height: 112 }}
          nodeColor="#666"
          maskColor="rgba(0,0,0,0.8)"
          pannable
        />
      </ReactFlow>

      {onTrigger && (
        <div className="process-floating-toolbar">
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
