import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LeftMenuTree } from "./LeftMenuTree";
import type { LeftMenuEntry } from "../types";

describe("LeftMenuTree", () => {
  it("renders static entries and invokes item selection", () => {
    const onSelect = vi.fn();
    const entries: LeftMenuEntry[] = [
      {
        kind: "item",
        id: "inbox",
        label: "Inbox",
        testId: "left-menu-inbox",
        onSelect,
      },
    ];

    render(<LeftMenuTree ariaLabel="Workspace navigation" entries={entries} />);

    fireEvent.click(screen.getByTestId("left-menu-inbox"));

    expect(screen.getByRole("tree", { name: "Workspace navigation" })).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders expanded group empty states", () => {
    const entries: LeftMenuEntry[] = [
      {
        kind: "group",
        id: "agents",
        label: "Agents",
        expanded: true,
        emptyState: {
          id: "empty-agents",
          label: "No agents yet",
          testId: "left-menu-empty-agents",
        },
        children: [],
        onActivate: vi.fn(),
      },
    ];

    render(<LeftMenuTree ariaLabel="Agent navigation" entries={entries} />);

    expect(screen.getByTestId("left-menu-empty-agents")).toHaveTextContent("No agents yet");
  });
});
