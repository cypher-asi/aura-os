import type { ExplorerNode } from "@cypher-asi/zui";

/**
 * Recursively filters an ExplorerNode tree by a search query.
 * A parent is kept if any descendant matches; matching is case-insensitive on the label.
 */
export function filterExplorerNodes(
  nodes: ExplorerNode[],
  query: string,
): ExplorerNode[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();

  function matches(node: ExplorerNode): ExplorerNode | null {
    const labelMatch =
      typeof node.label === "string" && node.label.toLowerCase().includes(lower);
    if (!node.children) return labelMatch ? node : null;

    const filtered = node.children
      .map(matches)
      .filter((n): n is ExplorerNode => n !== null);

    if (filtered.length > 0) {
      return { ...node, children: filtered };
    }
    return labelMatch ? { ...node, children: [] } : null;
  }

  return nodes.map(matches).filter((n): n is ExplorerNode => n !== null);
}
