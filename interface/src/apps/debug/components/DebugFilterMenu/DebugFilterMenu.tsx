import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, type MenuItem } from "@cypher-asi/zui";
import { ChevronDown } from "lucide-react";
import { useClickOutside } from "../../../../shared/hooks/use-click-outside";
import styles from "./DebugFilterMenu.module.css";

export interface DebugFilterOption {
  id: string;
  label: string;
}

interface Props {
  label: string;
  /** Value is matched against each option's `id`. */
  value: string;
  options: readonly DebugFilterOption[];
  onChange: (value: string) => void;
  "aria-label"?: string;
  /** Minimum menu width in pixels (default 200). */
  menuWidth?: number;
}

/**
 * Trigger-button dropdown backed by the `zui` `Menu`. We portal the menu
 * so parents with `overflow: hidden` (like the Debug main panel) can't
 * clip it — the native `<select>` the toolbar used previously was
 * getting hidden behind the lane chrome, which is what the user saw as
 * "hard to see".
 */
export function DebugFilterMenu({
  label,
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  menuWidth = 200,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside([triggerRef, menuRef], () => setOpen(false), open);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left });
  }, [open]);

  const items: MenuItem[] = options.map((option) => ({
    id: option.id,
    label: option.label,
  }));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.triggerLabel}>{label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.menuPortal}
              style={{ top: rect.top, left: rect.left, minWidth: menuWidth }}
            >
              <Menu
                items={items}
                value={value || undefined}
                onChange={(id) => {
                  setOpen(false);
                  onChange(id);
                }}
                background="solid"
                border="solid"
                rounded="md"
                width={menuWidth}
                isOpen
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
