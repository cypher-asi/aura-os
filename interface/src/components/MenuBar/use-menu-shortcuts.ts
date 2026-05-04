import { useEffect } from "react";
import { matchesShortcut } from "../../lib/platform";
import { MENU_DEFINITIONS, NATIVE_EDIT_ACTIONS, type MenuActionKey } from "./menu-config";
import type { MenuActionMap } from "./use-menu-actions";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return false;
}

interface UseMenuShortcutsOptions {
  actions: MenuActionMap;
  isItemDisabled: (key: MenuActionKey) => boolean;
}

/**
 * Installs a single document-level `keydown` listener that fires the same
 * action handlers used by the menu when the user presses a registered
 * shortcut anywhere in the app.
 *
 * Edit-menu shortcuts (Cut/Copy/Paste/Undo/Redo/Delete/Select All) are
 * deliberately left to the browser when focus sits inside an editable
 * element so the OS-native clipboard/undo machinery keeps working. Outside
 * editable focus the browser's defaults are no-ops anyway, so we don't
 * intercept them either — selecting the menu item itself still calls
 * `document.execCommand`.
 */
export function useMenuShortcuts({ actions, isItemDisabled }: UseMenuShortcutsOptions): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      for (const menu of MENU_DEFINITIONS) {
        for (const entry of menu.entries) {
          if (entry.type !== "item") continue;
          if (!entry.shortcut) continue;
          if (NATIVE_EDIT_ACTIONS.has(entry.id)) continue;
          if (!matchesShortcut(event, entry.shortcut)) continue;
          if (isItemDisabled(entry.id)) return;
          if (isEditableTarget(event.target) && entry.id === "view.toggleSidekick") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          actions[entry.id]();
          return;
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [actions, isItemDisabled]);
}
