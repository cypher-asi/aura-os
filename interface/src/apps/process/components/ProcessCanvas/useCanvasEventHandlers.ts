import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Connection, Node, Edge } from "@xyflow/react";
import type { ProcessNode, ProcessRun } from "../../../../types";
import type { ProcessNodeType } from "../../../../types/enums";
import { processApi } from "../../../../api/process";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { snap, type RenameState } from "./process-canvas-utils";

export interface UseCanvasEventHandlersParams {
  processId: string;
  processNodes: ProcessNode[];
  runs: ProcessRun[];
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  edges: Edge[];
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
  fetchNodes: (processId: string) => void;
  fetchConnections: (processId: string) => void;
}

export function useCanvasEventHandlers(params: UseCanvasEventHandlersParams) {
  const {
    processId, processNodes, runs,
    nodes, setNodes, edges, setEdges,
    screenToFlowPosition, fetchNodes, fetchConnections,
  } = params;

  const selectNode = useProcessSidekickStore((s) => s.selectNode);
  const closeNodeInspector = useProcessSidekickStore((s) => s.closeNodeInspector);
  const requestEdit = useProcessSidekickStore((s) => s.requestEdit);

  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [nodeCtxMenu, setNodeCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [edgeCtxMenu, setEdgeCtxMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);

  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const nodeCtxMenuRef = useRef<HTMLDivElement>(null);
  const edgeCtxMenuRef = useRef<HTMLDivElement>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  const togglePinNode = useCallback(
    async (nodeId: string) => {
      const node = processNodes.find((n) => n.node_id === nodeId);
      if (!node) return;

      const isPinned = !!node.config?.pinned_output;
      try {
        if (isPinned) {
          const newConfig = { ...node.config };
          delete newConfig.pinned_output;
          await processApi.updateNode(processId, nodeId, { config: newConfig });
        } else {
          let pinnedOutput: string | undefined;
          for (const run of runs) {
            const events = await processApi.listRunEvents(processId, run.run_id);
            const nodeEvent = events.find(
              (e) => e.node_id === nodeId && e.status === "completed" && !!e.output,
            );
            if (nodeEvent) {
              pinnedOutput = nodeEvent.output;
              break;
            }
          }
          if (!pinnedOutput) return;
          await processApi.updateNode(processId, nodeId, {
            config: { ...node.config, pinned_output: pinnedOutput },
          });
        }
        fetchNodes(processId);
      } catch (e) {
        console.error("Failed to toggle pin:", e);
      }
    },
    [processId, processNodes, runs, fetchNodes],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      const duplicate = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          (e.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
          (e.targetHandle ?? null) === (connection.targetHandle ?? null),
      );
      if (duplicate) return;

      const tempId = `temp-${Date.now()}`;
      const optimisticEdge: Edge = {
        id: tempId,
        source: connection.source!,
        target: connection.target!,
        ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
        ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
        animated: true,
      };
      setEdges((prev) => [...prev, optimisticEdge]);
      try {
        await processApi.createConnection(processId, {
          source_node_id: connection.source!,
          source_handle: connection.sourceHandle ?? undefined,
          target_node_id: connection.target!,
          target_handle: connection.targetHandle ?? undefined,
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

  useEffect(() => {
    const activeMenu = ctxMenu ? ctxMenuRef : nodeCtxMenu ? nodeCtxMenuRef : edgeCtxMenu ? edgeCtxMenuRef : null;
    if (!activeMenu) return;
    const dismiss = () => { setCtxMenu(null); setNodeCtxMenu(null); setEdgeCtxMenu(null); };
    const handleClickOutside = (e: MouseEvent) => {
      if (activeMenu.current && !activeMenu.current.contains(e.target as HTMLElement)) dismiss();
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ctxMenu, nodeCtxMenu, edgeCtxMenu]);

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

  return {
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
    togglePinNode,
    deleteConnection,
    setNodeCtxMenu,
    setEdgeCtxMenu,
    ctxMenu,
    nodeCtxMenu,
    edgeCtxMenu,
    ctxMenuRef,
    nodeCtxMenuRef,
    edgeCtxMenuRef,
  };
}
