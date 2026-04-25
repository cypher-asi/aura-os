import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Node } from "@xyflow/react";
import type { ProcessNode, ProcessNodeConnection } from "../../../../shared/types";
import { processApi } from "../../../../api/process";
import { snap, GRID } from "./process-canvas-utils";
import type { CanvasCommand } from "./useCanvasHistory";

interface ClipboardPayload {
  nodes: ProcessNode[];
  connections: ProcessNodeConnection[];
  anchorX: number;
  anchorY: number;
}

const PASTE_OFFSET = GRID * 2;

let clipboard: ClipboardPayload | null = null;

async function createNodeCopies(
  processId: string,
  sourceNodes: ProcessNode[],
  sourceConns: ProcessNodeConnection[],
  offsetX: number,
  offsetY: number,
  fetchNodes: (id: string) => void,
  fetchConnections: (id: string) => void,
): Promise<string[]> {
  const results = await Promise.all(
    sourceNodes.map(async (node) => {
      const config: Record<string, unknown> = node.config ? { ...node.config } : {};
      delete config.pinned_output;
      const created = await processApi.createNode(processId, {
        node_type: node.node_type,
        label: `${node.label} (copy)`,
        agent_id: node.agent_id ?? undefined,
        prompt: node.prompt,
        config: Object.keys(config).length > 0 ? config : undefined,
        position_x: snap(node.position_x + offsetX),
        position_y: snap(node.position_y + offsetY),
      });
      return { originalId: node.node_id, newId: created.node_id };
    }),
  );

  const idMap = new Map(results.map((r) => [r.originalId, r.newId]));
  const createdIds = results.map((r) => r.newId);

  await Promise.all(
    sourceConns.flatMap((c) => {
      // The preceding `idMap.has(...)` filter is fused in here: a missing
      // mapping means the connection's endpoint wasn't part of the
      // copied selection, so we silently drop the edge instead of
      // forcing a non-null lookup that could resurrect a stale id.
      const newSource = idMap.get(c.source_node_id);
      const newTarget = idMap.get(c.target_node_id);
      if (!newSource || !newTarget) return [];
      return [
        processApi.createConnection(processId, {
          source_node_id: newSource,
          source_handle: c.source_handle ?? undefined,
          target_node_id: newTarget,
          target_handle: c.target_handle ?? undefined,
        }),
      ];
    }),
  );

  fetchNodes(processId);
  fetchConnections(processId);
  return createdIds;
}

function makePasteCommand(
  processId: string,
  initialIds: string[],
  sourceNodes: ProcessNode[],
  sourceConns: ProcessNodeConnection[],
  offsetX: number,
  offsetY: number,
  fetchNodes: (id: string) => void,
  fetchConnections: (id: string) => void,
): CanvasCommand {
  const mutableIds = [...initialIds];
  return {
    async undo() {
      await Promise.all(mutableIds.map((id) => processApi.deleteNode(processId, id)));
      fetchNodes(processId);
      fetchConnections(processId);
    },
    async redo() {
      const newIds = await createNodeCopies(
        processId, sourceNodes, sourceConns, offsetX, offsetY, fetchNodes, fetchConnections,
      );
      mutableIds.length = 0;
      mutableIds.push(...newIds);
    },
  };
}

export interface UseCanvasClipboardParams {
  processId: string;
  processNodes: ProcessNode[];
  processConnections: ProcessNodeConnection[];
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  fetchNodes: (processId: string) => void;
  fetchConnections: (processId: string) => void;
  pushCommand: (cmd: CanvasCommand) => void;
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
}

export function useCanvasClipboard(params: UseCanvasClipboardParams) {
  const {
    processId, processNodes, processConnections,
    nodes, setNodes, fetchNodes, fetchConnections,
    pushCommand, screenToFlowPosition,
  } = params;

  const [, bumpClip] = useState(0);

  const gatherNodes = useCallback(
    (nodeIds: string[]) => {
      const idSet = new Set(nodeIds);
      const gathered = processNodes.filter(
        (n) => idSet.has(n.node_id) && n.node_type !== "ignition",
      );
      if (gathered.length === 0) return null;
      const gatherSet = new Set(gathered.map((n) => n.node_id));
      const conns = processConnections.filter(
        (c) => gatherSet.has(c.source_node_id) && gatherSet.has(c.target_node_id),
      );
      return { nodes: gathered, connections: conns };
    },
    [processNodes, processConnections],
  );

  const copyNodes = useCallback(
    (nodeIds: string[]) => {
      const data = gatherNodes(nodeIds);
      if (!data) return;
      clipboard = {
        nodes: data.nodes.map((n) => ({ ...n })),
        connections: data.connections.map((c) => ({ ...c })),
        anchorX: Math.min(...data.nodes.map((n) => n.position_x)),
        anchorY: Math.min(...data.nodes.map((n) => n.position_y)),
      };
      bumpClip((v) => v + 1);
    },
    [gatherNodes],
  );

  const copySelection = useCallback(() => {
    const ids = nodes.filter((n) => n.selected).map((n) => n.id);
    if (ids.length > 0) copyNodes(ids);
  }, [nodes, copyNodes]);

  const pasteNodes = useCallback(
    async (screenPos?: { x: number; y: number }) => {
      if (!clipboard || clipboard.nodes.length === 0) return;
      const { nodes: clipNodes, connections: clipConns, anchorX, anchorY } = clipboard;

      let offsetX = PASTE_OFFSET;
      let offsetY = PASTE_OFFSET;
      if (screenPos) {
        const flowPos = screenToFlowPosition(screenPos);
        offsetX = snap(flowPos.x) - anchorX;
        offsetY = snap(flowPos.y) - anchorY;
      }

      try {
        const createdIds = await createNodeCopies(
          processId, clipNodes, clipConns, offsetX, offsetY, fetchNodes, fetchConnections,
        );
        setTimeout(() => {
          setNodes((prev) => prev.map((n) => ({ ...n, selected: createdIds.includes(n.id) })));
        }, 150);
        pushCommand(makePasteCommand(
          processId, createdIds, clipNodes, clipConns, offsetX, offsetY, fetchNodes, fetchConnections,
        ));
        clipboard = { ...clipboard, anchorX: anchorX - PASTE_OFFSET, anchorY: anchorY - PASTE_OFFSET };
      } catch (e) {
        console.error("Failed to paste nodes:", e);
      }
    },
    [processId, fetchNodes, fetchConnections, setNodes, pushCommand, screenToFlowPosition],
  );

  const duplicateNodes = useCallback(
    async (nodeIds: string[]) => {
      const data = gatherNodes(nodeIds);
      if (!data) return;
      try {
        const createdIds = await createNodeCopies(
          processId, data.nodes, data.connections,
          PASTE_OFFSET, PASTE_OFFSET, fetchNodes, fetchConnections,
        );
        setTimeout(() => {
          setNodes((prev) => prev.map((n) => ({ ...n, selected: createdIds.includes(n.id) })));
        }, 150);
        pushCommand(makePasteCommand(
          processId, createdIds, data.nodes, data.connections,
          PASTE_OFFSET, PASTE_OFFSET, fetchNodes, fetchConnections,
        ));
      } catch (e) {
        console.error("Failed to duplicate nodes:", e);
      }
    },
    [processId, gatherNodes, fetchNodes, fetchConnections, setNodes, pushCommand],
  );

  const duplicateSelection = useCallback(async () => {
    const ids = nodes.filter((n) => n.selected).map((n) => n.id);
    if (ids.length > 0) await duplicateNodes(ids);
  }, [nodes, duplicateNodes]);

  return {
    copyNodes,
    copySelection,
    pasteNodes,
    duplicateNodes,
    duplicateSelection,
    hasClipboard: clipboard !== null && clipboard.nodes.length > 0,
  };
}
