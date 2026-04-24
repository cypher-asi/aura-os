import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "../../utils/clipboard";
import styles from "./CopyButton.module.css";

interface CopyButtonProps {
  /** Lazily-evaluated so streaming content is read at click time. */
  getText: () => string;
  className?: string;
  ariaLabel?: string;
  /** Hide the text label and render icon only. */
  iconOnly?: boolean;
}

const COPIED_RESET_MS = 1800;

/**
 * Small ghost-button that copies text to the clipboard and flips its
 * label to "Copied" for ~1.8s as a visual confirmation. Uses the
 * shared `copyToClipboard` helper, which handles the
 * `navigator.clipboard` path and an `execCommand` fallback so it
 * works across desktop and Capacitor WebViews on Android / iOS.
 *
 * Clicks are stopped from bubbling so this button can safely nest
 * inside collapsible cards whose headers toggle on click.
 */
export function CopyButton({
  getText,
  className,
  ariaLabel = "Copy",
  iconOnly = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      const text = getText();
      if (!text) return;
      try {
        await copyToClipboard(text);
        setCopied(true);
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, COPIED_RESET_MS);
      } catch (err) {
        console.warn("copy failed", err);
      }
    },
    [getText],
  );

  const label = copied ? "Copied" : "Copy";
  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      className={`${styles.button} ${copied ? styles.buttonCopied : ""} ${className ?? ""}`}
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-live="polite"
      data-testid="copy-button"
    >
      <Icon size={12} aria-hidden="true" />
      {iconOnly ? null : <span className={styles.label}>{label}</span>}
    </button>
  );
}
