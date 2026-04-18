import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

interface StubModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  footer?: ReactNode;
  children?: ReactNode;
}
interface StubButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({ isOpen, onClose, title, footer, children }: StubModalProps) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <div>{children}</div>
        <div>{footer}</div>
        <button type="button" aria-label="Close" onClick={onClose} />
      </div>
    ) : null,
  Button: ({ children, onClick, disabled }: StubButtonProps) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

interface StubRenameProps {
  target: { id: string; name: string };
  onSave: (name: string) => void;
  onCancel: () => void;
}
vi.mock("../../../components/InlineRenameInput", () => ({
  InlineRenameInput: ({ target, onSave, onCancel }: StubRenameProps) => (
    <div data-testid="rename-input" data-target-id={target.id}>
      <input defaultValue={target.name} aria-label="rename-input" />
      <button type="button" onClick={() => onSave("new-name")}>
        save
      </button>
      <button type="button" onClick={onCancel}>
        cancel
      </button>
    </div>
  ),
}));

import { NotesEntryModals } from "./NotesEntryModals";
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

describe("NotesEntryModals", () => {
  it("renders neither the rename nor the delete modal by default", () => {
    const { container } = render(
      <NotesEntryModals actions={makeApi()} />,
    );
    expect(container.querySelector("[data-testid='rename-input']")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the rename input when a rename target is set", () => {
    const handleRenameSave = vi.fn().mockResolvedValue(undefined);
    const api = makeApi({
      handleRenameSave,
      renameTarget: {
        kind: "note",
        projectId: "p1",
        relPath: "a.md",
        name: "a.md",
      },
    });
    render(<NotesEntryModals actions={api} />);
    expect(screen.getByTestId("rename-input")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save"));
    expect(handleRenameSave).toHaveBeenCalledWith("new-name");
  });

  it("renders the delete confirmation dialog when a delete target is set", () => {
    const handleDelete = vi.fn().mockResolvedValue(undefined);
    const api = makeApi({
      handleDelete,
      deleteTarget: {
        kind: "note",
        projectId: "p1",
        relPath: "a.md",
        name: "a.md",
      },
    });
    render(<NotesEntryModals actions={api} />);
    expect(screen.getByRole("dialog", { name: "Delete Note" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(handleDelete).toHaveBeenCalled();
  });

  it("warns that folder deletion includes children", () => {
    const api = makeApi({
      deleteTarget: {
        kind: "folder",
        projectId: "p1",
        relPath: "ideas",
        name: "ideas",
      },
    });
    render(<NotesEntryModals actions={api} />);
    expect(
      screen.getByText(/All notes inside the folder will be deleted/),
    ).toBeInTheDocument();
  });

  it("surfaces a delete error via role='alert'", () => {
    const api = makeApi({
      deleteError: "permission denied",
      deleteTarget: {
        kind: "note",
        projectId: "p1",
        relPath: "a.md",
        name: "a.md",
      },
    });
    render(<NotesEntryModals actions={api} />);
    expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
  });

  it("disables both buttons while deletion is in flight", () => {
    const api = makeApi({
      deleteLoading: true,
      deleteTarget: {
        kind: "note",
        projectId: "p1",
        relPath: "a.md",
        name: "a.md",
      },
    });
    render(<NotesEntryModals actions={api} />);
    expect(
      screen.getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Deleting..." }),
    ).toBeDisabled();
  });
});
