import type { ExplorerNode } from "@cypher-asi/zui";

export function filterTree(nodes: ExplorerNode[], q: string): ExplorerNode[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  return nodes.reduce<ExplorerNode[]>((acc, node) => {
    const labelMatch = node.label.toLowerCase().includes(lower);
    const filteredChildren = node.children ? filterTree(node.children, q) : [];
    if (labelMatch) acc.push(node);
    else if (filteredChildren.length > 0) acc.push({ ...node, children: filteredChildren });
    return acc;
  }, []);
}

export function getLastSelectedId(ids: Iterable<string>): string | null {
  let selectedId: string | null = null;
  for (const id of ids) {
    selectedId = id;
  }
  return selectedId;
}

export const STATUS_MAP: Record<string, string> = {
  running: "running",
  working: "running",
  idle: "idle",
  provisioning: "provisioning",
  hibernating: "hibernating",
  stopping: "stopping",
  stopped: "stopped",
  error: "error",
  blocked: "error",
};

export function resolveStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return STATUS_MAP[raw.toLowerCase()] ?? raw;
}
