import type { ExplorerNode } from "@cypher-asi/zui";
import type {
  LeftMenuEmptyEntry,
  LeftMenuEntry,
  LeftMenuGroupEntry,
  LeftMenuLeafEntry,
} from "./types";

interface BuildLeftMenuEntriesOptions {
  expandedIds: ReadonlySet<string>;
  selectedNodeId: string | null;
  searchActive?: boolean;
  groupToggleMode?: "activate" | "secondary";
  selectedGroupIds?: ReadonlySet<string>;
  groupTestIdPrefix?: string;
  itemTestIdPrefix?: string;
  emptyTestIdPrefix?: string;
  onGroupActivate: (nodeId: string) => void;
  onGroupToggle?: (nodeId: string) => void;
  onItemSelect: (nodeId: string) => void;
}

function buildTestId(prefix: string | undefined, nodeId: string): string | undefined {
  return prefix ? `${prefix}-${nodeId}` : undefined;
}

function isProjectEmptyNode(node: ExplorerNode): boolean {
  return node.metadata?.type === "project-empty";
}

function buildLeafEntry(
  node: ExplorerNode,
  selectedNodeId: string | null,
  itemTestIdPrefix: string | undefined,
  onItemSelect: (nodeId: string) => void,
): LeftMenuLeafEntry {
  return {
    kind: "item",
    id: node.id,
    label: node.label,
    icon: node.icon,
    suffix: node.suffix,
    disabled: Boolean(node.disabled),
    selected: selectedNodeId === node.id,
    testId: buildTestId(itemTestIdPrefix, node.id),
    onSelect: () => onItemSelect(node.id),
  };
}

function buildEmptyEntry(
  node: ExplorerNode | undefined,
  emptyTestIdPrefix: string | undefined,
  fallbackId: string,
): LeftMenuEmptyEntry | null {
  if (!node) return null;
  return {
    id: node.id,
    label: node.label,
    icon: node.icon,
    testId: buildTestId(emptyTestIdPrefix, fallbackId),
  };
}

function buildGroupEntry(
  node: ExplorerNode,
  options: BuildLeftMenuEntriesOptions,
): LeftMenuGroupEntry {
  const emptyNode = node.children?.find(isProjectEmptyNode);
  const childEntries = (node.children ?? [])
    .filter((childNode) => !isProjectEmptyNode(childNode))
    .map((childNode) =>
      buildLeafEntry(
        childNode,
        options.selectedNodeId,
        options.itemTestIdPrefix,
        options.onItemSelect,
      ),
    );

  return {
    kind: "group",
    id: node.id,
    label: node.label,
    suffix: node.suffix,
    expanded: Boolean(options.searchActive) || options.expandedIds.has(node.id),
    selected: options.selectedGroupIds?.has(node.id),
    testId: buildTestId(options.groupTestIdPrefix, node.id),
    toggleMode: options.groupToggleMode ?? "activate",
    children: childEntries,
    emptyState: buildEmptyEntry(emptyNode, options.emptyTestIdPrefix, node.id),
    onActivate: () => options.onGroupActivate(node.id),
    onToggle: options.onGroupToggle
      ? () => options.onGroupToggle?.(node.id)
      : undefined,
  };
}

export function buildLeftMenuEntries(
  nodes: ExplorerNode[],
  options: BuildLeftMenuEntriesOptions,
): LeftMenuEntry[] {
  return nodes.map((node) =>
    node.children
      ? buildGroupEntry(node, options)
      : buildLeafEntry(
          node,
          options.selectedNodeId,
          options.itemTestIdPrefix,
          options.onItemSelect,
        ),
  );
}
