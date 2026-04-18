import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  ChevronDown,
  Pin,
  PinOff,
} from "lucide-react";
import type { DetectedUrl } from "../../api/browser";
import styles from "./BrowserAddressBar.module.css";

export interface BrowserAddressBarProps {
  value: string;
  autoFocus?: boolean;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  pinnedUrl?: string | null;
  detectedUrls?: DetectedUrl[];
  onSubmit: (url: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  onReload?: () => void;
  onPin?: (url: string) => void;
  onUnpin?: () => void;
  onSelectDetected?: (url: string) => void;
}

export function BrowserAddressBar({
  value,
  autoFocus,
  loading,
  canGoBack,
  canGoForward,
  pinnedUrl,
  detectedUrls = [],
  onSubmit,
  onBack,
  onForward,
  onReload,
  onPin,
  onUnpin,
  onSelectDetected,
}: BrowserAddressBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const isPinned = Boolean(pinnedUrl && pinnedUrl === draft);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
    },
    [draft, onSubmit],
  );

  const handleTogglePin = useCallback(() => {
    if (isPinned) {
      onUnpin?.();
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) return;
    onPin?.(trimmed);
  }, [draft, isPinned, onPin, onUnpin]);

  const handleSelectDetected = useCallback(
    (url: string) => {
      setMenuOpen(false);
      onSelectDetected?.(url);
    },
    [onSelectDetected],
  );

  return (
    <form className={styles.root} onSubmit={handleSubmit} role="search">
      <button
        type="button"
        className={styles.navButton}
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Back"
        title="Back"
      >
        <ArrowLeft size={14} />
      </button>
      <button
        type="button"
        className={styles.navButton}
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Forward"
        title="Forward"
      >
        <ArrowRight size={14} />
      </button>
      <button
        type="button"
        className={styles.navButton}
        onClick={onReload}
        aria-label={loading ? "Stop" : "Reload"}
        title={loading ? "Stop" : "Reload"}
      >
        <RefreshCw size={14} />
      </button>
      <div className={styles.inputWrap}>
        <input
          ref={inputRef}
          className={styles.input}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter URL (http://localhost:5173)"
          aria-label="URL"
        />
        <div className={styles.inputActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleTogglePin}
            aria-pressed={isPinned}
            aria-label={isPinned ? "Unpin URL" : "Pin as default"}
            title={isPinned ? "Unpin URL" : "Pin as default"}
          >
            {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Detected URLs"
            title="Detected URLs"
          >
            <ChevronDown size={13} />
          </button>
        </div>
        {menuOpen && (
          <div className={styles.detectedMenu} role="menu">
            {detectedUrls.length === 0 ? (
              <div className={styles.detectedEmpty}>No detected URLs yet</div>
            ) : (
              detectedUrls.map((entry) => (
                <button
                  key={entry.url}
                  type="button"
                  role="menuitem"
                  className={styles.detectedItem}
                  onClick={() => handleSelectDetected(entry.url)}
                >
                  {entry.url}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </form>
  );
}
