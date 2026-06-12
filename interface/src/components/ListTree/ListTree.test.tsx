import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListTree } from "./ListTree";
import type { ListTreeNode } from "./types";

const nodes: ListTreeNode[] = [
  {
    id: "group-1",
    label: "Group One",
    children: [
      { id: "leaf-1", label: "Leaf One" },
      {
        id: "nested-1",
        label: "Nested Parent",
        children: [{ id: "deep-1", label: "Deep Leaf" }],
      },
    ],
  },
  { id: "leaf-2", label: "Top Leaf" },
];

describe("ListTree", () => {
  it("renders nested nodes with tree semantics", () => {
    render(<ListTree nodes={nodes} defaultExpandedIds={["group-1", "nested-1"]} />);

    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /Group One/ })).toHaveAttribute(
      "aria-level",
      "1",
    );
    expect(screen.getByRole("treeitem", { name: "Leaf One" })).toHaveAttribute(
      "aria-level",
      "2",
    );
    expect(screen.getByRole("treeitem", { name: "Deep Leaf" })).toHaveAttribute(
      "aria-level",
      "3",
    );
  });

  it("fires onSelect with the clicked node", () => {
    const onSelect = vi.fn();
    render(
      <ListTree
        nodes={nodes}
        defaultExpandedIds={["group-1"]}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("treeitem", { name: "Leaf One" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "leaf-1", label: "Leaf One" }),
    );
  });

  it("tracks uncontrolled selection on click", () => {
    render(<ListTree nodes={nodes} defaultExpandedIds={["group-1"]} />);

    const leaf = screen.getByRole("treeitem", { name: "Leaf One" });
    fireEvent.click(leaf);
    expect(leaf).toHaveAttribute("aria-selected", "true");
  });

  it("honors controlled selection", () => {
    render(
      <ListTree
        nodes={nodes}
        defaultExpandedIds={["group-1"]}
        selectedId="leaf-2"
      />,
    );

    expect(screen.getByRole("treeitem", { name: "Top Leaf" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("toggles a parent on row click when expandOnSelect is set", () => {
    const onExpand = vi.fn();
    render(<ListTree nodes={nodes} expandOnSelect onExpand={onExpand} />);

    fireEvent.click(screen.getByRole("treeitem", { name: /Group One/ }));
    expect(onExpand).toHaveBeenCalledWith("group-1", true);
  });

  it("reports chevron toggles through onExpand", () => {
    const onExpand = vi.fn();
    render(
      <ListTree
        nodes={nodes}
        defaultExpandedIds={["group-1"]}
        onExpand={onExpand}
      />,
    );

    const groupRow = screen.getByRole("treeitem", { name: /Group One/ });
    fireEvent.click(groupRow.querySelector("button[aria-label='Collapse']")!);
    expect(onExpand).toHaveBeenCalledWith("group-1", false);
  });

  it("renders an inline rename input for the editing node", () => {
    const onRenameCommit = vi.fn();
    render(
      <ListTree
        nodes={nodes}
        defaultExpandedIds={["group-1"]}
        editingNodeId="leaf-1"
        onRenameCommit={onRenameCommit}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(input, { target: { value: "Renamed Leaf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameCommit).toHaveBeenCalledWith("leaf-1", "Renamed Leaf");
  });

  it("renders node status content", () => {
    render(
      <ListTree
        nodes={[
          {
            id: "with-status",
            label: "Status Row",
            status: <span data-testid="row-status" />,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("row-status")).toBeInTheDocument();
  });
});
