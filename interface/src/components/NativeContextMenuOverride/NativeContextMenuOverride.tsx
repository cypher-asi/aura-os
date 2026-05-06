/**
 * Single source-of-truth for the native browser/WebView context menu in
 * AURA. Mounted once near the top of the React tree, this component:
 *
 *   1. Suppresses the WebView2 / WebKit native right-click menu (the
 *      Back / Refresh / Save as / Print / More tools / Inspect popup
 *      shown when the user right-clicks empty chrome) so AURA feels like
 *      a desktop OS rather than a Chromium tab.
 *   2. Defers to any in-app `onContextMenu` handler that already called
 *      `event.preventDefault()` — the existing per-app menus
 *      (DesktopContextMenu, NotesEntryContextMenu, ProcessCanvas...)
 *      keep working unchanged.
 *   3. Replaces the native input/textarea/contenteditable menu with a
 *      compact in-app Cut / Copy / Paste / Select All menu so right-click
 *      editing still works in text fields.
 *
 * The listener attaches in the document's bubble phase, so by the time
 * we run, React's synthetic event system has already dispatched every
 * `onContextMenu` prop along the bubble path. `event.defaultPrevented`
 * therefore reliably tells us whether an app menu has claimed the click.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Copy, Scissors, ClipboardPaste, TextCursor } from "lucide-react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import {
  copyFromTarget,
  cutFromTarget,
  getEditableTarget,
  getEditableTargetState,
  pasteIntoTarget,
  selectAllInTarget,
  type EditableTarget,
} from "./editable-target";
import styles from "./NativeContextMenuOverride.module.css";

const ESTIMATED_MENU_WIDTH = 220;
const ESTIMATED_MENU_HEIGHT = 192;
const VIEWPORT_PADDING = 8;

interface MenuPosition {
  x: number;
  y: number;
}

interface ActiveMenu {
  position: MenuPosition;
  target: EditableTarget;
  hasSelection: boolean;
  isReadonly: boolean;
}

type MenuActionId = "cut" | "copy" | "paste" | "select-all";

function computeOverlayStyle(position: MenuPosition): CSSProperties {
  if (typeof window === "undefined") {
    return { left: position.x, top: position.y };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const style: CSSProperties = {};

  const wouldOverflowBottom =
    position.y + ESTIMATED_MENU_HEIGHT > viewportHeight - VIEWPORT_PADDING;
  if (wouldOverflowBottom) {
    style.bottom = Math.max(VIEWPORT_PADDING, viewportHeight - position.y);
  } else {
    style.top = position.y;
  }

  const wouldOverflowRight =
    position.x + ESTIMATED_MENU_WIDTH > viewportWidth - VIEWPORT_PADDING;
  if (wouldOverflowRight) {
    style.right = Math.max(VIEWPORT_PADDING, viewportWidth - position.x);
  } else {
    style.left = position.x;
  }

  return style;
}

function buildMenuItems(active: ActiveMenu): MenuItem[] {
  const items: MenuItem[] = [];
  if (!active.isReadonly) {
    items.push({
      id: "cut" satisfies MenuActionId,
      label: "Cut",
      icon: <Scissors size={14} />,
      disabled: !active.hasSelection,
    });
  }
  items.push({
    id: "copy" satisfies MenuActionId,
    label: "Copy",
    icon: <Copy size={14} />,
    disabled: !active.hasSelection,
  });
  if (!active.isReadonly) {
    items.push({
      id: "paste" satisfies MenuActionId,
      label: "Paste",
      icon: <ClipboardPaste size={14} />,
    });
  }
  items.push({ type: "separator" });
  items.push({
    id: "select-all" satisfies MenuActionId,
    label: "Select All",
    icon: <TextCursor size={14} />,
  });
  return items;
}

export function NativeContextMenuOverride(): ReactNode {
  const [active, setActive] = useState<ActiveMenu | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Suppress the native context menu globally + open our editable menu
  // when there's nothing app-specific to defer to. We attach in the
  // bubble phase so app-level onContextMenu handlers (which run inside
  // React's synthetic event dispatch) get first chance to call
  // preventDefault() and signal "I'm handling this".
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      // An app-specific context menu already claimed this click — do
      // nothing, the native menu is already cancelled and the app menu
      // is opening through React state.
      if (event.defaultPrevented) {
        return;
      }

      event.preventDefault();

      const editable = getEditableTarget(event.target);
      if (!editable) {
        // Non-editable area + no app menu → suppress and show nothing.
        setActive(null);
        return;
      }

      const state = getEditableTargetState(editable);
      setActive({
        position: { x: event.clientX, y: event.clientY },
        target: editable,
        hasSelection: state.hasSelection,
        isReadonly: state.isReadonly,
      });
    };

    document.addEventListener("contextmenu", handler);
    return () => {
      document.removeEventListener("contextmenu", handler);
    };
  }, []);

  // Dismiss handlers (mirrors DesktopContextMenu): outside-click, Escape,
  // window resize/blur all close the menu.
  useEffect(() => {
    if (!active) return;
    const dismiss = () => setActive(null);
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (overlayRef.current && overlayRef.current.contains(event.target as Node)) return;
      dismiss();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [active]);

  const handleSelect = useCallback(
    (id: string) => {
      if (!active) return;
      const action = id as MenuActionId;
      const target = active.target;
      // Close the menu immediately so focus can return to the field
      // before async clipboard work completes — otherwise the menu
      // stays visible while we await readText().
      setActive(null);
      switch (action) {
        case "cut":
          cutFromTarget(target);
          return;
        case "copy":
          copyFromTarget(target);
          return;
        case "paste":
          void pasteIntoTarget(target);
          return;
        case "select-all":
          selectAllInTarget(target);
          return;
      }
    },
    [active],
  );

  const overlayStyle = useMemo(
    () => (active ? computeOverlayStyle(active.position) : null),
    [active],
  );
  const menuItems = useMemo(() => (active ? buildMenuItems(active) : []), [active]);

  const portalChildren = useMemo(() => {
    if (!active || !overlayStyle) return null;
    return (
      <div
        ref={overlayRef}
        className={styles.overlay}
        style={overlayStyle}
        data-testid="native-context-menu-override"
      >
        <Menu
          items={menuItems}
          onChange={handleSelect}
          background="solid"
          border="solid"
          rounded="md"
          width={200}
          isOpen
        />
      </div>
    );
  }, [active, overlayStyle, menuItems, handleSelect]);

  if (typeof document === "undefined" || !portalChildren) return null;
  return createPortal(portalChildren, document.body);
}
