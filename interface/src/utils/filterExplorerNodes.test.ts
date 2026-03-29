import { filterExplorerNodes } from "./filterExplorerNodes";
import type { ExplorerNode } from "@cypher-asi/zui";

function node(id: string, label: string, children?: ExplorerNode[]): ExplorerNode {
  return { id, label, children };
}

describe("filterExplorerNodes", () => {
  it("returns all nodes for empty query", () => {
    const nodes = [node("1", "Alpha"), node("2", "Beta")];
    expect(filterExplorerNodes(nodes, "")).toEqual(nodes);
  });

  it("filters by label case-insensitively", () => {
    const nodes = [node("1", "Alpha"), node("2", "Beta")];
    const result = filterExplorerNodes(nodes, "alpha");
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Alpha");
  });

  it("returns empty for no matches", () => {
    const nodes = [node("1", "Alpha"), node("2", "Beta")];
    expect(filterExplorerNodes(nodes, "gamma")).toEqual([]);
  });

  it("keeps parent if a child matches", () => {
    const tree = [
      node("1", "Parent", [node("1a", "Child Match")]),
    ];
    const result = filterExplorerNodes(tree, "child");
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Parent");
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].label).toBe("Child Match");
  });

  it("keeps parent if deeply nested child matches", () => {
    const tree = [
      node("1", "Root", [
        node("2", "Middle", [
          node("3", "Deep Match"),
        ]),
      ]),
    ];
    const result = filterExplorerNodes(tree, "deep");
    expect(result).toHaveLength(1);
    expect(result[0].children![0].children![0].label).toBe("Deep Match");
  });

  it("keeps matching parent even when children don't match", () => {
    const tree = [
      node("1", "Match Parent", [node("1a", "NoMatch")]),
    ];
    const result = filterExplorerNodes(tree, "match parent");
    expect(result).toHaveLength(1);
    expect(result[0].children).toEqual([]);
  });

  it("removes non-matching branches entirely", () => {
    const tree = [
      node("1", "Keep", [node("1a", "Target")]),
      node("2", "Remove", [node("2a", "Nope")]),
    ];
    const result = filterExplorerNodes(tree, "target");
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Keep");
  });

  it("handles nodes with no children (leaf nodes)", () => {
    const nodes = [node("1", "Leaf")];
    const result = filterExplorerNodes(nodes, "leaf");
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Leaf");
  });

  it("partial label match works", () => {
    const nodes = [node("1", "MyComponent.tsx")];
    const result = filterExplorerNodes(nodes, "comp");
    expect(result).toHaveLength(1);
  });
});
