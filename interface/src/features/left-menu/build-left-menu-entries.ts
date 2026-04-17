import type { ExplorerNode } from "@cypher-asi/zui";
import type { ExplorerNodeWithSuffix } from "../../lib/zui-compat";
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

function isEmptyStateNode(node: ExplorerNode): boolean {
  const type = node.metadata?.type;
  // `project-empty` is the original, app-specific sentinel; `empty` is the
  // generic one new apps (e.g. Notes) should use.
  return type === "empty" || type === "project-empty";
}

function isGroupNode(node: ExplorerNode): boolean {
  return Array.isArray(node.children);
}

function resolveGroupVariant(
  node: ExplorerNode,
): "default" | "section" {
  const variant = node.metadata?.variant;
  if (variant === "section" || variant === "default") {
    return variant;
  }
  // Backwards-compat: Agents uses `type: "agent-group"` for section headers.
  return node.metadata?.type === "agent-group" ? "section" : "default";
}

function buildLeafEntry(
  node: ExplorerNodeWithSuffix,
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
  node: ExplorerNodeWithSuffix,
  options: BuildLeftMenuEntriesOptions,
): LeftMenuGroupEntry {
  const emptyNode = node.children?.find(isEmptyStateNode);
  const childEntries = (node.children ?? [])
    .filter((childNode) => !isEmptyStateNode(childNode))
    .map((childNode) =>
      isGroupNode(childNode)
        ? buildGroupEntry(childNode, options)
        : buildLeafEntry(
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
    variant: resolveGroupVariant(node),
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
  nodes: ExplorerNodeWithSuffix[],
  options: BuildLeftMenuEntriesOptions,
): LeftMenuEntry[] {
  return nodes.map((node) =>
    isGroupNode(node)
      ? buildGroupEntry(node, options)
      : buildLeafEntry(
          node,
          options.selectedNodeId,
          options.itemTestIdPrefix,
          options.onItemSelect,
        ),
  );
}
