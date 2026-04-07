import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { ProcessNode, ProcessNodeConnection } from "../../../../types";
import type { NodeRunStatus } from "../../stores/process-sidekick-store";
import {
  toFlowNodes,
  toFlowEdges,
  type RenameState,
  type GroupResizeStopHandler,
} from "./process-canvas-utils";

export function useProcessCanvasFlowSync(params: {
  processNodes: ProcessNode[];
  processConnections: ProcessNodeConnection[];
  renameState: RenameState | undefined;
  nodeStatuses: Record<string, NodeRunStatus>;
  onGroupResizeStop: GroupResizeStopHandler;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  savedViewport: { x: number; y: number; zoom: number } | undefined;
  nodeCount: number;
  fitView: (opts?: { padding?: number }) => void;
}) {
  const {
    processNodes,
    processConnections,
    renameState,
    nodeStatuses,
    onGroupResizeStop,
    setNodes,
    setEdges,
    savedViewport,
    nodeCount,
    fitView,
  } = params;

  const hasAutoFitRef = useRef(false);

  useEffect(() => {
    setNodes((currentNodes) => {
      const incomingWithResize = toFlowNodes(processNodes, renameState, nodeStatuses, onGroupResizeStop);
      if (currentNodes.length === 0) return incomingWithResize;
      const currentById = new Map(currentNodes.map((n) => [n.id, n]));
      return incomingWithResize.map((n) => {
        const existing = currentById.get(n.id);
        return existing
          ? {
            ...existing,
            type: n.type,
            position: n.position,
            parentId: n.parentId,
            extent: n.extent,
            style: n.style,
            data: n.data,
          }
          : n;
      });
    });
  }, [processNodes, setNodes, renameState, nodeStatuses, onGroupResizeStop]);

  useEffect(() => {
    setEdges(toFlowEdges(processConnections, processNodes));
  }, [processConnections, processNodes, setEdges]);

  useEffect(() => {
    if (savedViewport || hasAutoFitRef.current || nodeCount === 0) return;

    hasAutoFitRef.current = true;
    const frameId = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.2 });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [savedViewport, nodeCount, fitView]);
}
