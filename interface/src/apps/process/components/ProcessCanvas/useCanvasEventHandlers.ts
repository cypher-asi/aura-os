import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Connection, Node, Edge } from "@xyflow/react";
import type { ProcessNode, ProcessNodeConnection, ProcessRun } from "../../../../shared/types";
import type { ProcessNodeType } from "../../../../shared/types/enums";
import { processApi } from "../../../../api/process";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import {
  snap,
  GROUP_CONFIG_WIDTH_KEY,
  GROUP_CONFIG_HEIGHT_KEY,
  GROUP_DEFAULT_WIDTH,
  GROUP_DEFAULT_HEIGHT,
  type RenameState,
} from "./process-canvas-utils";
import { useCanvasHistory } from "./useCanvasHistory";
import { useCanvasClipboard } from "./useCanvasClipboard";
import { useCanvasMenuDismissEffect, useCanvasKeyboardShortcutsEffect } from "./useCanvasDocumentListeners";

export interface UseCanvasEventHandlersParams {
  processId: string;
  processNodes: ProcessNode[];
  processConnections: ProcessNodeConnection[];
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
    processId, processNodes, processConnections, runs,
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
  const [selectionCtxMenu, setSelectionCtxMenu] = useState<{ x: number; y: number; nodeIds: string[] } | null>(null);

  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const nodeCtxMenuRef = useRef<HTMLDivElement>(null);
  const edgeCtxMenuRef = useRef<HTMLDivElement>(null);
  const selectionCtxMenuRef = useRef<HTMLDivElement>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { pushCommand, undo, redo, canUndo, canRedo } = useCanvasHistory();

  /* ── Rename ─────────────────────────────────────────────── */

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

  /* ── Delete nodes (with undo) ───────────────────────────── */

  const deleteNodes = useCallback(
    async (nodeIds: string[]) => {
      const deletable = nodeIds.filter((id) => {
        const n = processNodes.find((pn) => pn.node_id === id);
        return n && n.node_type !== "ignition";
      });
      if (deletable.length === 0) return;

      const deletedNodes = deletable
        .map((id) => processNodes.find((n) => n.node_id === id))
        .filter((n): n is ProcessNode => !!n)
        .map((n) => ({ ...n }));
      const deletedIdSet = new Set(deletable);
      const incidentConns = processConnections
        .filter((c) => deletedIdSet.has(c.source_node_id) || deletedIdSet.has(c.target_node_id))
        .map((c) => ({ ...c }));

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

      const mNodes = deletedNodes;
      const mConns = incidentConns;
      pushCommand({
        async undo() {
          const idMap = new Map<string, string>();
          for (const node of mNodes) {
            const created = await processApi.createNode(processId, {
              node_type: node.node_type,
              label: node.label,
              agent_id: node.agent_id ?? undefined,
              prompt: node.prompt,
              config: node.config,
              position_x: node.position_x,
              position_y: node.position_y,
            });
            idMap.set(node.node_id, created.node_id);
          }
          for (const conn of mConns) {
            const src = idMap.get(conn.source_node_id) ?? conn.source_node_id;
            const tgt = idMap.get(conn.target_node_id) ?? conn.target_node_id;
            await processApi.createConnection(processId, {
              source_node_id: src,
              source_handle: conn.source_handle ?? undefined,
              target_node_id: tgt,
              target_handle: conn.target_handle ?? undefined,
            });
          }
          for (const node of mNodes) {
            const newId = idMap.get(node.node_id);
            if (newId) node.node_id = newId;
          }
          for (const conn of mConns) {
            const s = idMap.get(conn.source_node_id);
            if (s) conn.source_node_id = s;
            const t = idMap.get(conn.target_node_id);
            if (t) conn.target_node_id = t;
          }
          fetchNodes(processId);
          fetchConnections(processId);
        },
        async redo() {
          await Promise.all(mNodes.map((n) => processApi.deleteNode(processId, n.node_id)));
          fetchNodes(processId);
          fetchConnections(processId);
        },
      });
    },
    [processId, processNodes, processConnections, setNodes, setEdges, fetchNodes, fetchConnections, closeNodeInspector, pushCommand],
  );

  /* ── Delete confirmation gate ───────────────────────────── */

  const [pendingDeleteNodeIds, setPendingDeleteNodeIds] = useState<string[] | null>(null);

  const requestDeleteNodes = useCallback(
    (nodeIds: string[]) => {
      const deletable = nodeIds.filter((id) => {
        const n = processNodes.find((pn) => pn.node_id === id);
        return n && n.node_type !== "ignition";
      });
      if (deletable.length === 0) return;
      setPendingDeleteNodeIds(deletable);
    },
    [processNodes],
  );

  const confirmDeleteNodes = useCallback(() => {
    if (pendingDeleteNodeIds) deleteNodes(pendingDeleteNodeIds);
    setPendingDeleteNodeIds(null);
  }, [pendingDeleteNodeIds, deleteNodes]);

  const cancelDeleteNodes = useCallback(() => {
    setPendingDeleteNodeIds(null);
  }, []);

  /* ── Pin / unpin ────────────────────────────────────────── */

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
            if (nodeEvent) { pinnedOutput = nodeEvent.output; break; }
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

  /* ── Connect (with undo) ────────────────────────────────── */

  const onConnect = useCallback(
    async (connection: Connection) => {
      const { source, target } = connection;
      // React Flow types `Connection.source`/`target` as `string | null`
      // — a partial drag-in-progress emits null fields. Bail out so we
      // never persist or render an edge with a missing endpoint.
      if (!source || !target) return;

      const sourceNode = processNodes.find((n) => n.node_id === source);
      const targetNode = processNodes.find((n) => n.node_id === target);
      if (sourceNode?.node_type === "group" || targetNode?.node_type === "group") return;

      const duplicate = edges.some(
        (e) =>
          e.source === source &&
          e.target === target &&
          (e.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
          (e.targetHandle ?? null) === (connection.targetHandle ?? null),
      );
      if (duplicate) return;

      const tempId = `temp-${Date.now()}`;
      const optimisticEdge: Edge = {
        id: tempId,
        source,
        target,
        ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
        ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
        animated: true,
        type: "step",
      };
      setEdges((prev) => [...prev, optimisticEdge]);

      const connPayload = {
        source_node_id: source,
        source_handle: connection.sourceHandle ?? undefined,
        target_node_id: target,
        target_handle: connection.targetHandle ?? undefined,
      };

      try {
        const created = await processApi.createConnection(processId, connPayload);
        fetchConnections(processId);

        let connId = created.connection_id;
        pushCommand({
          async undo() {
            await processApi.deleteConnection(processId, connId);
            fetchConnections(processId);
          },
          async redo() {
            const recreated = await processApi.createConnection(processId, connPayload);
            connId = recreated.connection_id;
            fetchConnections(processId);
          },
        });
      } catch (e) {
        console.error("Failed to save connection:", e);
        setEdges((prev) => prev.filter((edge) => edge.id !== tempId));
      }
    },
    [processId, fetchConnections, setEdges, edges, processNodes, pushCommand],
  );

  /* ── Add node (with undo) ───────────────────────────────── */

  const handleAddNode = useCallback(
    async (type: ProcessNodeType, label: string) => {
      if (!ctxMenu) return;
      const flowPos = screenToFlowPosition({ x: ctxMenu.x, y: ctxMenu.y });
      setCtxMenu(null);
      try {
        const config = type === "group"
          ? { [GROUP_CONFIG_WIDTH_KEY]: GROUP_DEFAULT_WIDTH, [GROUP_CONFIG_HEIGHT_KEY]: GROUP_DEFAULT_HEIGHT }
          : undefined;
        const posX = snap(flowPos.x);
        const posY = snap(flowPos.y);
        const created = await processApi.createNode(processId, {
          node_type: type, label, position_x: posX, position_y: posY, ...(config ? { config } : {}),
        });
        fetchNodes(processId);

        let nodeId = created.node_id;
        pushCommand({
          async undo() {
            await processApi.deleteNode(processId, nodeId);
            fetchNodes(processId);
          },
          async redo() {
            const recreated = await processApi.createNode(processId, {
              node_type: type, label, position_x: posX, position_y: posY, ...(config ? { config } : {}),
            });
            nodeId = recreated.node_id;
            fetchNodes(processId);
          },
        });
      } catch (e) {
        console.error("Failed to create node:", e);
      }
    },
    [processId, ctxMenu, screenToFlowPosition, fetchNodes, pushCommand],
  );

  /* ── Context menus ──────────────────────────────────────── */

  const dismissMenus = useCallback(() => {
    setCtxMenu(null);
    setNodeCtxMenu(null);
    setEdgeCtxMenu(null);
    setSelectionCtxMenu(null);
  }, []);

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    setNodeCtxMenu(null);
    setEdgeCtxMenu(null);
    setSelectionCtxMenu(null);
    setCtxMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      if (node.type === "groupNode") {
        const isLabel = (event.target as HTMLElement).closest("[data-group-label]");
        if (!isLabel) {
          setNodeCtxMenu(null);
          setEdgeCtxMenu(null);
          setSelectionCtxMenu(null);
          setCtxMenu({ x: event.clientX, y: event.clientY });
          return;
        }
      }
      setCtxMenu(null);
      setEdgeCtxMenu(null);
      setSelectionCtxMenu(null);
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
        setEdgeCtxMenu(null);
        setSelectionCtxMenu(null);
        setNodeCtxMenu({ x: event.clientX, y: event.clientY, nodeId: selected[0].id });
      } else if (selected.length > 1) {
        setCtxMenu(null);
        setNodeCtxMenu(null);
        setEdgeCtxMenu(null);
        setSelectionCtxMenu({ x: event.clientX, y: event.clientY, nodeIds: selected.map((n) => n.id) });
      }
    },
    [nodes],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setCtxMenu(null);
      setNodeCtxMenu(null);
      setSelectionCtxMenu(null);
      setEdgeCtxMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    [],
  );

  /* ── Delete / disconnect connections (with undo) ────────── */

  const deleteConnection = useCallback(
    async (connectionId: string) => {
      const connData = processConnections.find((c) => c.connection_id === connectionId);
      setEdges((prev) => prev.filter((e) => e.id !== connectionId));
      try {
        await processApi.deleteConnection(processId, connectionId);
      } catch (e) {
        console.error("Failed to delete connection:", e);
      }
      fetchConnections(processId);

      if (connData) {
        let currentId = connectionId;
        const payload = {
          source_node_id: connData.source_node_id,
          source_handle: connData.source_handle ?? undefined,
          target_node_id: connData.target_node_id,
          target_handle: connData.target_handle ?? undefined,
        };
        pushCommand({
          async undo() {
            const recreated = await processApi.createConnection(processId, payload);
            currentId = recreated.connection_id;
            fetchConnections(processId);
          },
          async redo() {
            await processApi.deleteConnection(processId, currentId);
            fetchConnections(processId);
          },
        });
      }
    },
    [processId, processConnections, setEdges, fetchConnections, pushCommand],
  );

  const disconnectNode = useCallback(
    async (nodeId: string) => {
      const incident = edges.filter((e) => e.source === nodeId || e.target === nodeId);
      if (incident.length === 0) return;

      const savedConns = incident
        .map((e) => processConnections.find((c) => c.connection_id === e.id))
        .filter((c): c is ProcessNodeConnection => !!c)
        .map((c) => ({ ...c }));

      setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
      try {
        await Promise.all(incident.map((e) => processApi.deleteConnection(processId, e.id)));
      } catch (e) {
        console.error("Failed to disconnect node:", e);
      }
      fetchConnections(processId);

      const mConns = savedConns;
      pushCommand({
        async undo() {
          for (const conn of mConns) {
            const created = await processApi.createConnection(processId, {
              source_node_id: conn.source_node_id,
              source_handle: conn.source_handle ?? undefined,
              target_node_id: conn.target_node_id,
              target_handle: conn.target_handle ?? undefined,
            });
            conn.connection_id = created.connection_id;
          }
          fetchConnections(processId);
        },
        async redo() {
          await Promise.all(mConns.map((c) => processApi.deleteConnection(processId, c.connection_id)));
          fetchConnections(processId);
        },
      });
    },
    [processId, edges, processConnections, setEdges, fetchConnections, pushCommand],
  );

  /* ── Node interaction ───────────────────────────────────── */

  const onNodeClick = useCallback(
    (event: React.MouseEvent, flowNode: Node) => {
      if (event.ctrlKey || event.metaKey) return;
      const processNode = processNodes.find((n) => n.node_id === flowNode.id);
      if (processNode) selectNode(processNode);
    },
    [processNodes, selectNode],
  );

  const onNodeDoubleClick = useCallback(
    (event: React.MouseEvent, flowNode: Node) => {
      if (event.ctrlKey || event.metaKey) return;
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

  /* ── Drag / resize (with undo) ──────────────────────────── */

  const onNodeDragStop = useCallback(
    async (_: unknown, node: Node) => {
      const selectedNodes = nodes.filter((n) => n.selected);
      const nodesToPersist = selectedNodes.length > 0 ? selectedNodes : [node];
      const uniqueById = new Map(nodesToPersist.map((n) => [n.id, n]));
      if (!uniqueById.has(node.id)) uniqueById.set(node.id, node);

      const changes = Array.from(uniqueById.values()).map((moved) => {
        const original = processNodes.find((n) => n.node_id === moved.id);
        return {
          nodeId: moved.id,
          oldX: original ? original.position_x : moved.position.x,
          oldY: original ? original.position_y : moved.position.y,
          newX: snap(moved.position.x),
          newY: snap(moved.position.y),
        };
      });

      const hasMoved = changes.some((c) => snap(c.oldX) !== c.newX || snap(c.oldY) !== c.newY);
      if (!hasMoved) return;

      try {
        await Promise.all(
          changes.map((c) =>
            processApi.updateNode(processId, c.nodeId, { position_x: c.newX, position_y: c.newY }),
          ),
        );
        fetchNodes(processId);

        pushCommand({
          async undo() {
            setNodes((prev) =>
              prev.map((n) => {
                const c = changes.find((ch) => ch.nodeId === n.id);
                return c ? { ...n, position: { x: snap(c.oldX), y: snap(c.oldY) } } : n;
              }),
            );
            await Promise.all(
              changes.map((c) =>
                processApi.updateNode(processId, c.nodeId, { position_x: snap(c.oldX), position_y: snap(c.oldY) }),
              ),
            );
            fetchNodes(processId);
          },
          async redo() {
            setNodes((prev) =>
              prev.map((n) => {
                const c = changes.find((ch) => ch.nodeId === n.id);
                return c ? { ...n, position: { x: c.newX, y: c.newY } } : n;
              }),
            );
            await Promise.all(
              changes.map((c) =>
                processApi.updateNode(processId, c.nodeId, { position_x: c.newX, position_y: c.newY }),
              ),
            );
            fetchNodes(processId);
          },
        });
      } catch (e) {
        console.error("Failed to save node position:", e);
      }
    },
    [processId, nodes, processNodes, fetchNodes, pushCommand, setNodes],
  );

  const onGroupResizeStop = useCallback(
    async (nodeId: string, x: number, y: number, width: number, height: number) => {
      const processNode = processNodes.find((n) => n.node_id === nodeId);
      if (!processNode || processNode.node_type !== "group") return;
      const nextWidth = Math.max(220, snap(width));
      const nextHeight = Math.max(150, snap(height));
      const nextConfig: Record<string, unknown> = {
        ...((processNode.config as Record<string, unknown>) ?? {}),
        [GROUP_CONFIG_WIDTH_KEY]: nextWidth,
        [GROUP_CONFIG_HEIGHT_KEY]: nextHeight,
      };
      try {
        await processApi.updateNode(processId, nodeId, {
          position_x: snap(x), position_y: snap(y), config: nextConfig,
        });
        fetchNodes(processId);
      } catch (e) {
        console.error("Failed to save group size:", e);
      }
    },
    [processId, processNodes, fetchNodes],
  );

  /* ── Clipboard ──────────────────────────────────────────── */

  const {
    copyNodes, copySelection, pasteNodes, duplicateNodes, duplicateSelection, hasClipboard,
  } = useCanvasClipboard({
    processId, processNodes, processConnections,
    nodes, setNodes, fetchNodes, fetchConnections,
    pushCommand, screenToFlowPosition,
  });

  useCanvasMenuDismissEffect(
    ctxMenu,
    nodeCtxMenu,
    edgeCtxMenu,
    selectionCtxMenu,
    ctxMenuRef,
    nodeCtxMenuRef,
    edgeCtxMenuRef,
    selectionCtxMenuRef,
    dismissMenus,
  );

  useCanvasKeyboardShortcutsEffect(
    wrapperRef,
    nodes,
    requestDeleteNodes,
    copySelection,
    pasteNodes,
    deleteNodes,
    undo,
    redo,
  );

  return {
    renameState,
    renamingNodeId,
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
    duplicateSelection,
    hasClipboard,
    undo,
    redo,
    canUndo,
    canRedo,
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
  };
}
