import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, X } from "lucide-react";
import styles from "./LoginEmailSelect.module.css";

interface LoginEmailSelectProps {
  value: string;
  emails: string[];
  onSelect: (email: string) => void;
  onAddAccount: () => void;
  onRemove: (email: string) => void;
  disabled?: boolean;
}

/**
 * Account picker that replaces the plain email `Input` on the Sign In
 * tab once the visitor has at least one remembered account. Lists the
 * saved emails (each with a remove control) and an "Add an account"
 * action that drops the form back to free-text entry for a new login.
 * Styled to read like the surrounding ZUI inputs; uses the same
 * portal + reposition approach as `components/Select`.
 */
export function LoginEmailSelect({
  value,
  emails,
  onSelect,
  onAddAccount,
  onRemove,
  disabled,
}: LoginEmailSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = Math.min(280, (emails.length + 1) * 38 + 8);
    const top =
      spaceBelow >= dropdownHeight ? rect.bottom + 4 : rect.top - dropdownHeight - 4;
    setPos({ top, left: rect.left, width: rect.width });
  }, [emails.length]);

  useEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handleSelect = (email: string) => {
    onSelect(email);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleAdd = () => {
    setOpen(false);
    onAddAccount();
  };

  const handleRemove = (e: React.MouseEvent, email: string) => {
    e.stopPropagation();
    onRemove(email);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`${styles.triggerLabel}${!value ? ` ${styles.placeholder}` : ""}`}>
          {value || "Email"}
        </span>
        <ChevronDown
          size={14}
          className={`${styles.chevron}${open ? ` ${styles.chevronOpen}` : ""}`}
        />
      </button>

      {open &&
        createPortal(
          <>
            <div className={styles.overlay} onClick={() => setOpen(false)} />
            {pos && (
              <div
                ref={dropdownRef}
                className={styles.dropdown}
                role="listbox"
                style={{ top: pos.top, left: pos.left, width: pos.width }}
              >
                {emails.map((email) => (
                  <div
                    key={email}
                    role="option"
                    aria-selected={email === value}
                    className={`${styles.option}${email === value ? ` ${styles.optionSelected}` : ""}`}
                    onClick={() => handleSelect(email)}
                  >
                    <span className={styles.optionLabel}>{email}</span>
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={(e) => handleRemove(e, email)}
                      aria-label={`Forget ${email}`}
                      title="Forget this account"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <div className={styles.divider} />
                <button
                  type="button"
                  className={styles.addAccount}
                  onClick={handleAdd}
                >
                  <Plus size={14} />
                  <span>Add an account</span>
                </button>
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
