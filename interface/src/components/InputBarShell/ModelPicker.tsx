import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import styles from "./InputBarShell.module.css";

export interface ModelOptionLike {
  id: string;
  label: string;
}

export interface ModelPickerProps {
  /** Display label for the trigger button (e.g. the active model name). */
  selectedLabel: string;
  /**
   * When true (default), the button is interactive and opens the menu.
   * When false, the button is rendered as plain text (no chevron, no menu).
   */
  isInteractive?: boolean;
  /**
   * Render-prop for the menu content. Receives a `close` callback so menu
   * items can dismiss the dropdown after selection.
   */
  renderMenu: (close: () => void) => ReactNode;
  /** Show a chevron icon next to the label. Defaults to `isInteractive`. */
  showChevron?: boolean;
  /** Extra props for the trigger button (e.g. data-attrs). */
  triggerProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "className"> & {
    [dataAttr: `data-${string}`]: string | number | boolean | undefined;
  };
  /** Extra className appended to the wrapper. */
  className?: string;
  /** Extra className appended to the trigger button. */
  buttonClassName?: string;
  /**
   * Extra className appended to the portaled menu wrapper. Use this to
   * carry size/styling overrides into the portal (the menu lives under
   * `document.body`, so descendant selectors anchored on the consumer's
   * own DOM will not match).
   */
  menuClassName?: string;
  /**
   * Called when the menu opens. Use for menu-local state resets (e.g.
   * collapsing a "show all" subview); the picker preserves focus on
   * whatever element was active before the click, so consumers should
   * not blur the textarea here.
   */
  onOpen?: () => void;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  right: number;
}

/**
 * Reusable model picker used by both `ChatInputBar` and the aura3d
 * `PromptInput`. Owns the trigger button + dropdown chrome (positioning,
 * click-outside dismissal). Menu items are supplied by the caller via
 * `renderMenu` so each consumer can render flat / grouped / featured
 * variants while sharing the visual style.
 *
 * The menu is rendered through a `document.body` portal with
 * `position: fixed` coordinates so it stops getting clipped by any
 * ancestor `overflow: hidden` (the chat panel sits inside several:
 * `.lane`, `.laneContent`, `.mainContent`, `.mainPanelHost`,
 * `.chatView`). Without the portal, the menu — which extends leftward
 * from the trigger thanks to `right: 0; min-width: 140px` — gets sliced
 * at the chat panel's left edge, reading visually as if the adjacent
 * sidebar lane were cutting it off.
 */
export const ModelPicker = memo(function ModelPicker({
  selectedLabel,
  isInteractive = true,
  renderMenu,
  showChevron,
  triggerProps,
  className,
  buttonClassName,
  menuClassName,
  onOpen,
}: ModelPickerProps) {
  // Estimate of the menu's max rendered height, used to decide whether
  // to flip from "open up" (the natural direction for a bottom-anchored
  // input bar) to "open down" when the trigger sits near the top of the
  // viewport. Matches the menu chrome's `max-height: 280px` plus a bit
  // of slack for box-shadow / borders.
  const ESTIMATED_MENU_HEIGHT = 320;
  const MENU_MARGIN = 4;

  const computePosFromRect = (rect: DOMRect): MenuPosition => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const right = Math.max(8, viewportWidth - rect.right);
    const spaceAbove = rect.top;
    if (spaceAbove >= ESTIMATED_MENU_HEIGHT) {
      return {
        bottom: viewportHeight - rect.top + MENU_MARGIN,
        right,
      };
    }
    return { top: rect.bottom + MENU_MARGIN, right };
  };

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const close = useCallback(() => setOpen(false), []);

  // Subscribe to scroll/resize while open so the portal tracks the
  // trigger when ancestor scroll containers (the chat transcript, a
  // dialog body, …) move. setState lives inside the listener
  // callbacks, not in the effect body, so this stays clean from the
  // perspective of `react-hooks/set-state-in-effect`.
  useEffect(() => {
    if (!open) return;
    const reflow = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos(computePosFromRect(rect));
    };
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("[data-model-menu-root='true']")
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handleClick = useCallback(() => {
    if (!isInteractive) return;
    setOpen((v) => {
      if (v) return false;
      // Read the trigger's bounding rect at click time so the portaled
      // menu has accurate coordinates on its very first paint — no
      // useLayoutEffect-driven setState pass needed, which means we
      // don't trip `react-hooks/set-state-in-effect`.
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos(computePosFromRect(rect));
      onOpen?.();
      return true;
    });
  }, [isInteractive, onOpen]);

  const wrapperClass = [styles.modelMenuWrap, className].filter(Boolean).join(" ");
  const buttonClass = [styles.modelButton, buttonClassName].filter(Boolean).join(" ");
  const portalWrapperClass = [styles.modelMenuPortal, menuClassName]
    .filter(Boolean)
    .join(" ");
  const chevron = showChevron ?? isInteractive;

  // Keep the user's prior focus target (typically the chat textarea)
  // active when interacting with the picker. Buttons grab focus on
  // mousedown by default; preventDefault on the bubbled mousedown
  // event suppresses the focus change while still firing the click,
  // so opening the menu and selecting a model both leave the caret
  // exactly where the user left it. Mirrors the pattern used by
  // `SlidingPills` for the mode bar.
  const handleMouseDownPreserveFocus = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
    },
    [],
  );

  const portalStyle: CSSProperties | undefined = pos
    ? {
        position: "fixed",
        right: pos.right,
        ...(pos.top != null ? { top: pos.top } : {}),
        ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
        zIndex: 10000,
      }
    : undefined;

  return (
    <div className={wrapperClass} data-model-menu-root="true">
      <button
        ref={triggerRef}
        {...triggerProps}
        type="button"
        className={buttonClass}
        onMouseDown={isInteractive ? handleMouseDownPreserveFocus : undefined}
        onClick={isInteractive ? handleClick : undefined}
        aria-haspopup={isInteractive ? "menu" : undefined}
        aria-expanded={isInteractive ? open : undefined}
        style={isInteractive ? undefined : { cursor: "default" }}
      >
        {selectedLabel}
        {chevron && <ChevronDown size={10} />}
      </button>
      {open && isInteractive && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              data-model-menu-root="true"
              className={portalWrapperClass}
              onMouseDown={handleMouseDownPreserveFocus}
              style={portalStyle}
            >
              {renderMenu(close)}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
