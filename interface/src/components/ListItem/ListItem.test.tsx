import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListItem } from "./ListItem";

describe("ListItem", () => {
  it("renders the slot order: leading, icon, title, secondary, meta, status", () => {
    render(
      <ListItem
        title="Row title"
        secondary="Second line"
        leading={<span data-testid="leading" />}
        icon={<span data-testid="icon" />}
        meta={<span data-testid="meta" />}
        status={<span data-testid="status" />}
      />,
    );

    const row = screen.getByRole("treeitem");
    const order = [
      screen.getByTestId("leading"),
      screen.getByTestId("icon"),
      screen.getByText("Row title"),
      screen.getByText("Second line"),
      screen.getByTestId("meta"),
      screen.getByTestId("status"),
    ].map((el) => {
      let node: Element | null = el;
      while (node && node.parentElement !== row) node = node.parentElement;
      return Array.from(row.children).indexOf(node as Element);
    });

    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });

  it("fires onSelect on click and Enter", () => {
    const onSelect = vi.fn();
    render(<ListItem title="Clickable" onSelect={onSelect} />);

    const row = screen.getByRole("treeitem", { name: "Clickable" });
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("does not fire onSelect when disabled", () => {
    const onSelect = vi.fn();
    render(<ListItem title="Disabled" disabled onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("treeitem"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders a chevron for rows with children and toggles expansion", () => {
    render(
      <ListItem title="Parent" defaultExpanded={false}>
        <ListItem title="Child" />
      </ListItem>,
    );

    const parent = screen.getByRole("treeitem", { name: /Parent/ });
    expect(parent).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(parent).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "Child" })).toBeInTheDocument();
  });

  it("toggles a controlled parent through onExpandedChange without selecting", () => {
    const onExpandedChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <ListItem
        title="Controlled"
        expanded={false}
        onExpandedChange={onExpandedChange}
        onSelect={onSelect}
      >
        <ListItem title="Child" />
      </ListItem>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("expands and collapses with arrow keys", () => {
    render(
      <ListItem title="Parent">
        <ListItem title="Child" />
      </ListItem>,
    );

    const parent = screen.getByRole("treeitem", { name: /Parent/ });
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    expect(parent).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(parent, { key: "ArrowLeft" });
    expect(parent).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a copy button when copyText is provided", () => {
    render(<ListItem title="With copy" copyText="copied text" />);
    expect(screen.getByTestId("copy-button")).toBeInTheDocument();
  });

  it("does not select the row when clicking the trailing slot", () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    render(
      <ListItem
        title="With trailing"
        onSelect={onSelect}
        trailing={
          <button type="button" onClick={onAction}>
            Act
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Act" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders a rename input in editing mode and commits on Enter", () => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    render(
      <ListItem
        title="Old name"
        editing
        onRenameCommit={onRenameCommit}
        onRenameCancel={onRenameCancel}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameCommit).toHaveBeenCalledWith("New name");
  });

  it("cancels rename on Escape and on unchanged commit", () => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    render(
      <ListItem
        title="Same"
        editing
        onRenameCommit={onRenameCommit}
        onRenameCancel={onRenameCancel}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameCommit).not.toHaveBeenCalled();
    expect(onRenameCancel).toHaveBeenCalledTimes(2);
  });
});
