import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

interface StubMenuItem {
  id?: string;
  label?: string;
  type?: string;
}
interface StubMenuProps {
  items: readonly StubMenuItem[];
  onChange: (id: string) => void;
}
vi.mock("@cypher-asi/zui", () => ({
  Menu: ({ items, onChange }: StubMenuProps) => (
    <ul data-testid="menu">
      {items.map((item, i) =>
        item.type === "separator" ? (
          <li key={`sep-${i}`} role="separator" />
        ) : (
          <li key={item.id}>
            <button type="button" onClick={() => onChange(item.id!)}>
              {item.label}
            </button>
          </li>
        ),
      )}
    </ul>
  ),
}));

import { NotesEntryContextMenu } from "./NotesEntryContextMenu";
import type { NotesContextMenuApi } from "../NotesNav/useNotesContextMenu";

function makeApi(
  overrides: Partial<NotesContextMenuApi> = {},
): NotesContextMenuApi {
  return {
    ctxMenu: null,
    ctxMenuRef: createRef<HTMLDivElement>(),
    handleContextMenu: vi.fn(),
    handleKeyDown: vi.fn(),
    handleMenuAction: vi.fn(),
    renameTarget: null,
    setRenameTarget: vi.fn(),
    handleRenameSave: vi.fn().mockResolvedValue(undefined),
    deleteTarget: null,
    setDeleteTarget: vi.fn(),
    deleteLoading: false,
    deleteError: null,
    setDeleteError: vi.fn(),
    handleDelete: vi.fn().mockResolvedValue(undefined),
    parentRelPathFor: () => "",
    ...overrides,
  };
}

describe("NotesEntryContextMenu", () => {
  it("renders nothing when there is no active context menu", () => {
    const api = makeApi();
    const { container } = render(<NotesEntryContextMenu actions={api} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders note-oriented menu items for a note target", () => {
    const api = makeApi({
      ctxMenu: {
        x: 10,
        y: 20,
        target: {
          kind: "note",
          projectId: "p1",
          relPath: "a.md",
          name: "a.md",
        },
      },
    });
    render(<NotesEntryContextMenu actions={api} />);
    expect(
      screen.getByRole("button", { name: "Rename" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reveal in folder" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New note" }),
    ).not.toBeInTheDocument();
  });

  it("renders folder-oriented menu items for a folder target", () => {
    const api = makeApi({
      ctxMenu: {
        x: 0,
        y: 0,
        target: {
          kind: "folder",
          projectId: "p1",
          relPath: "ideas",
          name: "ideas",
        },
      },
    });
    render(<NotesEntryContextMenu actions={api} />);
    expect(screen.getByRole("button", { name: "New note" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New folder" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reveal in folder" }),
    ).not.toBeInTheDocument();
  });

  it("delegates menu selections to handleMenuAction", () => {
    const handleMenuAction = vi.fn();
    const api = makeApi({
      handleMenuAction,
      ctxMenu: {
        x: 0,
        y: 0,
        target: {
          kind: "note",
          projectId: "p1",
          relPath: "a.md",
          name: "a.md",
        },
      },
    });
    render(<NotesEntryContextMenu actions={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(handleMenuAction).toHaveBeenCalledWith("rename");
  });
});
