import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
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
  /** Called when the menu opens — useful for blurring textarea on touch. */
  onOpen?: () => void;
}

/**
 * Reusable model picker used by both `ChatInputBar` and the aura3d
 * `PromptInput`. Owns the trigger button + dropdown chrome (positioning,
 * click-outside dismissal). Menu items are supplied by the caller via
 * `renderMenu` so each consumer can render flat / grouped / featured
 * variants while sharing the visual style.
 */
export const ModelPicker = memo(function ModelPicker({
  selectedLabel,
  isInteractive = true,
  renderMenu,
  showChevron,
  triggerProps,
  className,
  buttonClassName,
  onOpen,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

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
      const next = !v;
      if (next) onOpen?.();
      return next;
    });
  }, [isInteractive, onOpen]);

  const wrapperClass = [styles.modelMenuWrap, className].filter(Boolean).join(" ");
  const buttonClass = [styles.modelButton, buttonClassName].filter(Boolean).join(" ");
  const chevron = showChevron ?? isInteractive;

  return (
    <div className={wrapperClass} data-model-menu-root="true">
      <button
        {...triggerProps}
        type="button"
        className={buttonClass}
        onClick={isInteractive ? handleClick : undefined}
        aria-haspopup={isInteractive ? "menu" : undefined}
        aria-expanded={isInteractive ? open : undefined}
        style={isInteractive ? undefined : { cursor: "default" }}
      >
        {selectedLabel}
        {chevron && <ChevronDown size={10} />}
      </button>
      {open && isInteractive && renderMenu(close)}
    </div>
  );
});
