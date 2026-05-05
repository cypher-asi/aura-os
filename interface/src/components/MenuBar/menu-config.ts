import type { ShortcutSpec } from "../../lib/platform";

export type MenuActionKey =
  | "file.newAgent"
  | "file.newWindow"
  | "file.newProject"
  | "file.settings"
  | "file.exit"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.toggleSidekick"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.actualSize"
  | "view.previousAgent"
  | "view.nextAgent"
  | "view.toggleFullscreen"
  | "help.visitWebsite"
  | "help.gettingStarted";

export interface MenuItemEntry {
  type: "item";
  id: MenuActionKey;
  label: string;
  shortcut?: ShortcutSpec;
}

export interface MenuDividerEntry {
  type: "divider";
}

export type MenuEntry = MenuItemEntry | MenuDividerEntry;

export interface MenuDefinition {
  id: "file" | "edit" | "view" | "help";
  label: string;
  entries: MenuEntry[];
}

const DIVIDER: MenuDividerEntry = { type: "divider" };

export const MENU_DEFINITIONS: MenuDefinition[] = [
  {
    id: "file",
    label: "File",
    entries: [
      { type: "item", id: "file.newAgent", label: "New Agent", shortcut: { key: "n", mod: true } },
      DIVIDER,
      { type: "item", id: "file.newWindow", label: "New Window", shortcut: { key: "n", mod: true, shift: true } },
      { type: "item", id: "file.newProject", label: "New Project", shortcut: { key: "p", mod: true, shift: true } },
      DIVIDER,
      { type: "item", id: "file.settings", label: "Settings", shortcut: { key: ",", mod: true } },
      DIVIDER,
      { type: "item", id: "file.exit", label: "Exit", shortcut: { key: "w", mod: true } },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    entries: [
      { type: "item", id: "edit.undo", label: "Undo", shortcut: { key: "z", mod: true } },
      { type: "item", id: "edit.redo", label: "Redo", shortcut: { key: "y", mod: true } },
      DIVIDER,
      { type: "item", id: "edit.cut", label: "Cut", shortcut: { key: "x", mod: true } },
      { type: "item", id: "edit.copy", label: "Copy", shortcut: { key: "c", mod: true } },
      { type: "item", id: "edit.paste", label: "Paste", shortcut: { key: "v", mod: true } },
      { type: "item", id: "edit.delete", label: "Delete", shortcut: { key: "Delete" } },
      DIVIDER,
      { type: "item", id: "edit.selectAll", label: "Select All", shortcut: { key: "a", mod: true } },
    ],
  },
  {
    id: "view",
    label: "View",
    entries: [
      { type: "item", id: "view.toggleSidekick", label: "Toggle Sidekick", shortcut: { key: "b", mod: true } },
      DIVIDER,
      { type: "item", id: "view.zoomIn", label: "Zoom In", shortcut: { key: "=", mod: true } },
      { type: "item", id: "view.zoomOut", label: "Zoom Out", shortcut: { key: "-", mod: true } },
      { type: "item", id: "view.actualSize", label: "Actual Size", shortcut: { key: "0", mod: true } },
      DIVIDER,
      { type: "item", id: "view.previousAgent", label: "Previous Agent", shortcut: { key: "ArrowLeft", mod: true, alt: true } },
      { type: "item", id: "view.nextAgent", label: "Next Agent", shortcut: { key: "ArrowRight", mod: true, alt: true } },
      DIVIDER,
      { type: "item", id: "view.toggleFullscreen", label: "Toggle Full Screen", shortcut: { key: "F11" } },
    ],
  },
  {
    id: "help",
    label: "Help",
    entries: [
      { type: "item", id: "help.visitWebsite", label: "Visit aura.ai" },
      { type: "item", id: "help.gettingStarted", label: "Getting Started" },
    ],
  },
];

/** Edit-menu actions whose shortcuts must be left to the browser when focus
 * sits in an editable element — so typing Ctrl+C in a `<textarea>` still uses
 * the OS-native clipboard implementation rather than our menu intercept. */
export const NATIVE_EDIT_ACTIONS: ReadonlySet<MenuActionKey> = new Set([
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.delete",
  "edit.selectAll",
]);
