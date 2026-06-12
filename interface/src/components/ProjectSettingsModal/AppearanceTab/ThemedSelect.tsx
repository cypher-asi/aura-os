import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, Check } from "lucide-react";
import styles from "./ThemedSelect.module.css";

export interface ThemedSelectOption<T extends string> {
  value: T;
  label: string;
}

interface ThemedSelectProps<T extends string> {
  value: T;
  options: readonly ThemedSelectOption<T>[];
  onChange: (next: T) => void;
  ariaLabel?: string;
}

/**
 * Themed replacement for a native `<select>`. We can't reliably style
 * the native popup in WebView2 (Chromium on Windows ignores
 * `color-scheme` for the OS-rendered dropdown widget), so this
 * component renders the trigger as a styled button and the option
 * list as an absolutely-positioned menu that follows the rest of
 * the app's CSS tokens.
 *
 * Intentionally small — only the behavior the appearance tab needs:
 * click trigger to toggle, click option to select-and-close, click
 * outside or Escape to close. No multi-select, no async loading, no
 * combo-box typing. Add features here only when a second caller
 * actually needs them.
 */
export function ThemedSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: ThemedSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? value;

  // Close on outside click or Escape so the menu behaves like the
  // user expects from a native dropdown.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSelect = useCallback(
    (next: T) => {
      onChange(next);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const handleTriggerKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Open on space / enter / arrow down to match select semantics.
    if (
      event.key === " " ||
      event.key === "Enter" ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKey}
      >
        <span className={styles.triggerLabel}>{label}</span>
        <ChevronDown size={14} className={styles.triggerChevron} aria-hidden="true" />
      </button>
      {open && (
        <ul
          className={styles.menu}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  className={`${styles.option} ${active ? styles.optionActive : ""}`}
                  role="option"
                  aria-selected={active}
                  onClick={() => handleSelect(opt.value)}
                >
                  <span className={styles.optionLabel}>{opt.label}</span>
                  {active && (
                    <Check size={14} className={styles.optionCheck} aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
