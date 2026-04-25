import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  ChevronDown,
  Star,
  Lock,
  Globe,
} from "lucide-react";
import type { DetectedUrl } from "../../shared/api/browser";
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

function duckDuckGoSearchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasWhitespace = /\s/.test(trimmed);
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);

  let candidate: string | null = null;
  if (hasScheme) {
    candidate = trimmed;
  } else if (!hasWhitespace) {
    if (
      /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[^\]]+\]|[^/\s]+:\d+)(?:[/?#]|$)/.test(
        trimmed,
      )
    ) {
      candidate = `http://${trimmed}`;
    } else if (trimmed.includes(".")) {
      candidate = `https://${trimmed}`;
    }
  }

  if (candidate) {
    try {
      return new URL(candidate).toString();
    } catch {
      // fall through to search fallback
    }
  }

  return duckDuckGoSearchUrl(trimmed);
}

export function BrowserAddressBar({
  value,
  autoFocus,
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
      const normalized = normalizeBrowserUrl(draft);
      if (!normalized) return;
      onSubmit(normalized);
    },
    [draft, onSubmit],
  );

  const handleTogglePin = useCallback(() => {
    if (isPinned) {
      onUnpin?.();
      return;
    }
    const normalized = normalizeBrowserUrl(draft);
    if (!normalized) return;
    onPin?.(normalized);
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
        aria-label="Reload"
        title="Reload"
      >
        <RefreshCw size={14} />
      </button>
      <div className={styles.inputWrap}>
        <span className={styles.inputIcon} aria-hidden="true">
          {draft.startsWith("https://") ? (
            <Lock size={12} />
          ) : (
            <Globe size={12} />
          )}
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
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
            <Star size={13} fill={isPinned ? "currentColor" : "none"} />
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
