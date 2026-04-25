import { useEffect, useState } from "react";
import type { ProcessRun, ProcessNode, ProcessNodeConnection } from "../../../../shared/types";

export const EMPTY_RUNS: ProcessRun[] = [];
export const EMPTY_NODES: ProcessNode[] = [];

const pulseKeyframes = `
@keyframes aura-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.6; }
}
@keyframes aura-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

export function injectKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("aura-process-keyframes")) return;
  const style = document.createElement("style");
  style.id = "aura-process-keyframes";
  style.textContent = pulseKeyframes;
  document.head.appendChild(style);
}

export function useElapsedTime(startedAt: string, isActive: boolean): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "\u2014";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return "\u2014";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function countRunnableProcessNodes(
  nodes: ProcessNode[],
  connections: ProcessNodeConnection[],
): number {
  if (nodes.length === 0) return 0;

  const groupIds = new Set(
    nodes
      .filter((node) => node.node_type === "group")
      .map((node) => node.node_id),
  );

  const adjacency = new Map<string, string[]>();
  for (const connection of connections) {
    if (groupIds.has(connection.source_node_id) || groupIds.has(connection.target_node_id)) {
      continue;
    }

    const downstream = adjacency.get(connection.source_node_id);
    if (downstream) {
      downstream.push(connection.target_node_id);
    } else {
      adjacency.set(connection.source_node_id, [connection.target_node_id]);
    }
  }

  const visited = new Set<string>();
  const queue = nodes
    .filter((node) => node.node_type === "ignition")
    .map((node) => node.node_id);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;

    visited.add(nodeId);
    const nextNodeIds = adjacency.get(nodeId) ?? [];
    for (const nextNodeId of nextNodeIds) {
      if (!visited.has(nextNodeId)) {
        queue.push(nextNodeId);
      }
    }
  }

  return visited.size;
}
